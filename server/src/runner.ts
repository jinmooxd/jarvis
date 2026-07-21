import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import * as pty from "node-pty";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { resolveClaudeBinary } from "./claudeBinary.js";
import { getRecord, putRecord } from "./store.js";

const execFileAsync = promisify(execFile);

// All claude sessions live in a dedicated tmux server (its own socket), so
// they survive jarvis restarts and never collide with the user's own tmux.
const TMUX_SOCKET = "jarvis";
const TMUX_CONF = join(import.meta.dirname, "..", "tmux.conf");

export type CreateSessionInput = {
  name: string;
  repoPath: string;
  model: string;
  oneMillionContext?: boolean;
  worktree?: { mode: "main" } | { mode: "existing"; path: string } | { mode: "new"; name: string };
};

function tmuxArgs(...args: string[]): string[] {
  return ["-L", TMUX_SOCKET, "-f", TMUX_CONF, ...args];
}

async function tmux(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("tmux", tmuxArgs(...args));
  return stdout;
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

// If claude fails to launch, the tmux session would die before anyone attaches
// and the error would be lost — hold the pane open so it can be read.
function claudeShellCommand(bin: string, flags: string[]): string {
  const cmd = [bin, ...flags].map(shellQuote).join(" ");
  return `${cmd}; code=$?; if [ $code -ne 0 ]; then printf '\\n[claude exited with status %s — press Enter to close]\\n' "$code"; read line; fi`;
}

async function spawnTmuxSession(claudeSessionId: string, cwd: string, flags: string[]): Promise<void> {
  const bin = (await resolveClaudeBinary()) ?? "claude";
  await tmux(
    "new-session",
    "-d",
    "-s",
    claudeSessionId,
    "-c",
    cwd,
    "-x",
    "220",
    "-y",
    "50",
    claudeShellCommand(bin, flags),
  );
}

function oneMillionFlags(enabled: boolean | undefined): string[] {
  return enabled ? ["--betas", "context-1m-2025-08-07"] : [];
}

export async function createSession(input: CreateSessionInput): Promise<{ claudeSessionId: string }> {
  const claudeSessionId = randomUUID();
  let cwd = input.repoPath;
  const flags = ["--session-id", claudeSessionId, "--model", input.model, "--name", input.name];
  if (input.worktree?.mode === "existing") {
    cwd = input.worktree.path;
  } else if (input.worktree?.mode === "new") {
    flags.push("--worktree", input.worktree.name);
  }
  flags.push(...oneMillionFlags(input.oneMillionContext));

  await spawnTmuxSession(claudeSessionId, cwd, flags);

  await putRecord({
    claudeSessionId,
    name: input.name,
    repoPath: input.repoPath,
    worktreePath: input.worktree?.mode === "existing" ? input.worktree.path : undefined,
    model: input.model,
    oneMillionContext: input.oneMillionContext,
    createdAt: Date.now(),
  });

  return { claudeSessionId };
}

export async function isLive(claudeSessionId: string): Promise<boolean> {
  try {
    await tmux("has-session", "-t", `=${claudeSessionId}`);
    return true;
  } catch {
    return false;
  }
}

export async function listLiveSessionIds(): Promise<string[]> {
  try {
    const out = await tmux("list-sessions", "-F", "#{session_name}");
    return out.split("\n").filter(Boolean);
  } catch {
    // no tmux server running → no live sessions
    return [];
  }
}

const pendingResume = new Map<string, Promise<void>>();

// Make sure a tmux session exists for this id, resuming the conversation if
// the process died (server reboot, /exit, machine restart).
export function ensureLive(claudeSessionId: string): Promise<void> {
  const inFlight = pendingResume.get(claudeSessionId);
  if (inFlight) return inFlight;

  const job = (async () => {
    if (await isLive(claudeSessionId)) return;

    const record = await getRecord(claudeSessionId);
    const flags = ["--resume", claudeSessionId];
    let cwd: string | undefined;
    if (record) {
      cwd = record.worktreePath ?? record.repoPath;
      if (record.model) flags.push("--model", record.model);
      flags.push("--name", record.name, ...oneMillionFlags(record.oneMillionContext));
    } else {
      // Session created outside jarvis (plain terminal) — transcript knows the cwd.
      const s = (await listSessions()).find((x) => x.sessionId === claudeSessionId);
      cwd = s?.cwd;
    }
    if (!cwd) throw new Error(`unknown session ${claudeSessionId}`);

    await spawnTmuxSession(claudeSessionId, cwd, flags);
  })().finally(() => pendingResume.delete(claudeSessionId));

  pendingResume.set(claudeSessionId, job);
  return job;
}

// One PTY per viewer, each running its own `tmux attach`. tmux redraws the
// full screen on attach, which doubles as scrollback/state replay for
// reconnecting clients. Killing the PTY only detaches the viewer.
export function attachSession(claudeSessionId: string, cols: number, rows: number): pty.IPty {
  return pty.spawn("tmux", tmuxArgs("attach-session", "-t", `=${claudeSessionId}`), {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME ?? "/",
    env: { ...process.env, COLORTERM: "truecolor" } as { [key: string]: string },
  });
}

export async function getPanePid(claudeSessionId: string): Promise<number | undefined> {
  try {
    const out = await tmux("list-panes", "-s", "-t", `=${claudeSessionId}`, "-F", "#{pane_pid}");
    const pid = Number(out.split("\n").filter(Boolean)[0]);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

export async function killSession(claudeSessionId: string): Promise<void> {
  try {
    await tmux("kill-session", "-t", `=${claudeSessionId}`);
  } catch {
    // already dead — that's the desired state
  }
}
