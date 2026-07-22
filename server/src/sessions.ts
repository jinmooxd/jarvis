import { open, readdir, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_DIR, contextWindowForModel } from "./config.js";
import { getAllRecords, getClosedMap, getRecord, unmarkClosed } from "./store.js";
import { getPanePid, isLive, listLiveSessionIds } from "./runner.js";

export type SessionStatus = "live" | "external" | "cold";

// A session not on the jarvis tmux socket but whose transcript was touched
// within this window is treated as "external" — actively running somewhere
// else (e.g. a `claude` started directly in a Cursor terminal).
export const EXTERNAL_ACTIVE_MS = 120_000;

function isRecentlyActive(lastModified: number): boolean {
  return Date.now() - lastModified < EXTERNAL_ACTIVE_MS;
}

// For callers (e.g. the WS handler) that only have the session id: derive
// external-activity from the transcript file's mtime.
export async function isExternallyActive(
  sessionId: string,
  lastModified?: number,
): Promise<boolean> {
  if (lastModified !== undefined) return isRecentlyActive(lastModified);
  const path = await findTranscript(sessionId);
  if (!path) return false;
  try {
    const { mtimeMs } = await stat(path);
    return isRecentlyActive(mtimeMs);
  } catch {
    return false;
  }
}

export type ContextInfo = {
  usedTokens: number;
  windowTokens: number;
  pct: number;
};

export type SessionSummary = {
  claudeSessionId: string;
  name: string;
  repoPath: string;
  gitBranch?: string;
  model: string;
  status: SessionStatus;
  context?: ContextInfo;
  lastModified: number;
  createdAt?: number;
};

export async function listAllSessions(): Promise<SessionSummary[]> {
  const [sdkSessions, records, closed, liveIds] = await Promise.all([
    listSessions(),
    getAllRecords(),
    getClosedMap(),
    listLiveSessionIds(),
  ]);
  const live = new Set(liveIds);
  const seen = new Set<string>();
  const out: SessionSummary[] = [];

  for (const s of sdkSessions) {
    seen.add(s.sessionId);
    const closedAt = closed[s.sessionId];
    if (closedAt !== undefined) {
      // transcript activity after the close (e.g. /resume from another
      // session) brings it back into the list
      if (s.lastModified <= closedAt && !live.has(s.sessionId)) continue;
      await unmarkClosed(s.sessionId);
    }
    const record = records[s.sessionId];
    // live (on the jarvis socket) wins; otherwise a recently-touched
    // transcript means it's running externally; else it's cold.
    const status: SessionStatus = live.has(s.sessionId)
      ? "live"
      : isRecentlyActive(s.lastModified)
        ? "external"
        : "cold";
    out.push({
      claudeSessionId: s.sessionId,
      name: record?.name ?? s.customTitle ?? s.summary ?? s.firstPrompt ?? "Untitled session",
      repoPath: record?.repoPath ?? s.cwd ?? "",
      gitBranch: s.gitBranch,
      model: record?.model ?? "",
      status,
      context:
        status === "live" || status === "external" || record
          ? await contextFor(s.sessionId, s.lastModified, record?.model, record?.oneMillionContext)
          : undefined,
      lastModified: s.lastModified,
      createdAt: s.createdAt,
    });
  }

  // Sessions we just created may not be flushed to the on-disk transcript yet.
  for (const [id, record] of Object.entries(records)) {
    if (seen.has(id) || closed[id] !== undefined) continue;
    out.push({
      claudeSessionId: id,
      name: record.name,
      repoPath: record.repoPath,
      model: record.model,
      status: live.has(id) ? "live" : "cold",
      lastModified: record.createdAt,
      createdAt: record.createdAt,
    });
  }

  out.sort((a, b) => b.lastModified - a.lastModified);
  return out;
}

// ---- context % from transcripts ------------------------------------------
// Without the SDK message stream we read token usage straight from the session
// transcript (~/.claude/projects/**/<id>.jsonl), which the CLI flushes
// continuously. Only the tail is read, and only when lastModified changes.

const contextCache = new Map<string, { lastModified: number; context?: ContextInfo }>();
const transcriptPathCache = new Map<string, string>();
const TAIL_BYTES = 256 * 1024;

async function contextFor(
  sessionId: string,
  lastModified: number,
  recordModel?: string,
  oneMillionContext?: boolean,
): Promise<ContextInfo | undefined> {
  const cached = contextCache.get(sessionId);
  if (cached && cached.lastModified === lastModified) return cached.context;

  let context: ContextInfo | undefined;
  try {
    const usage = await readLastUsage(sessionId);
    if (usage) {
      const used =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
      const windowTokens = contextWindowForModel(usage.model ?? recordModel, oneMillionContext);
      const pct = Math.min(100, Math.round((used / windowTokens) * 1000) / 10);
      context = { usedTokens: used, windowTokens, pct };
    }
  } catch {
    // unreadable/missing transcript → no badge
  }
  contextCache.set(sessionId, { lastModified, context });
  return context;
}

export async function findTranscript(sessionId: string): Promise<string | undefined> {
  const cached = transcriptPathCache.get(sessionId);
  if (cached) return cached;
  const projectsDir = join(CLAUDE_DIR, "projects");
  let dirs: string[] = [];
  try {
    dirs = await readdir(projectsDir);
  } catch {
    return undefined;
  }
  for (const dir of dirs) {
    const candidate = join(projectsDir, dir, `${sessionId}.jsonl`);
    try {
      const handle = await open(candidate, "r");
      await handle.close();
      transcriptPathCache.set(sessionId, candidate);
      return candidate;
    } catch {
      // not in this project dir
    }
  }
  return undefined;
}

type TranscriptUsage = {
  model?: string;
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type SessionDetails = {
  claudeSessionId: string;
  name: string;
  status: SessionStatus;
  pid?: number;
  cwd?: string;
  host: string;
  model?: string;
  createdAt?: number;
  updatedAt?: number;
};

export async function getSessionDetails(sessionId: string): Promise<SessionDetails> {
  const [record, live, sdk] = await Promise.all([
    getRecord(sessionId),
    isLive(sessionId),
    listSessions().then((all) => all.find((s) => s.sessionId === sessionId)),
  ]);
  const usage = await readLastUsage(sessionId).catch(() => undefined);
  const status: SessionStatus = live
    ? "live"
    : sdk && isRecentlyActive(sdk.lastModified)
      ? "external"
      : "cold";
  return {
    claudeSessionId: sessionId,
    name: record?.name ?? sdk?.customTitle ?? sdk?.summary ?? sdk?.firstPrompt ?? "Untitled session",
    status,
    pid: live ? await getPanePid(sessionId) : undefined,
    cwd: record?.worktreePath ?? sdk?.cwd ?? record?.repoPath,
    host: hostname(),
    model: usage?.model ?? (record?.model || undefined),
    createdAt: record?.createdAt ?? sdk?.createdAt,
    updatedAt: sdk?.lastModified ?? record?.createdAt,
  };
}

async function readLastUsage(sessionId: string): Promise<TranscriptUsage | undefined> {
  const path = await findTranscript(sessionId);
  if (!path) return undefined;

  const handle = await open(path, "r");
  let text: string;
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await handle.read(buf, 0, buf.length, start);
    text = buf.toString("utf-8");
  } finally {
    await handle.close();
  }

  const lines = text.split("\n");
  // first line may be truncated by the tail cut — it just fails to parse
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      // subagent (sidechain) turns have their own context window — skip them
      if (entry.type !== "assistant" || entry.isSidechain === true) continue;
      const usage = entry.message?.usage;
      if (usage && usage.input_tokens != null) {
        return { ...usage, model: entry.message?.model };
      }
    } catch {
      // partial or non-JSON line
    }
  }
  return undefined;
}
