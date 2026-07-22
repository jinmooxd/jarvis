import { watch, type FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { WebSocket } from "ws";
import { findTranscript } from "./sessions.js";
import { renderTail, renderTranscriptEntry } from "./transcriptRender.js";

// Read-only mirror of an externally-running session (e.g. `claude` started in a
// Cursor terminal, outside the jarvis tmux socket). We can't attach a PTY to
// that process, so instead we tail its JSONL transcript and render the
// conversation as terminal text — never spawning a competing `claude --resume`
// fork.

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

const BANNER =
  `${DIM}Read-only mirror — this session is running in another terminal ` +
  `(e.g. Cursor). Live transcript follows.${RESET}\r\n\r\n`;

// How much of the transcript tail to replay on connect.
const TAIL_BYTES = 64 * 1024;

export type MirrorHandle = { close(): void };

export async function startMirror(sessionId: string, ws: WebSocket): Promise<MirrorHandle> {
  const send = (s: string) => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(s, "utf8"));
  };

  send(BANNER);

  const path = await findTranscript(sessionId);
  if (!path) {
    send(`${DIM}(transcript not found — nothing to mirror)${RESET}\r\n`);
    return { close() {} };
  }

  // `offset` = bytes physically read from the file so far.
  // `buffer` = bytes read but not yet terminated by a newline (a partial line
  //            carried across reads so we never parse half a JSON object).
  let offset = 0;
  let buffer = "";

  // Initial tail replay.
  try {
    const { size } = await stat(path);
    const start = Math.max(0, size - TAIL_BYTES);
    const len = size - start;
    const buf = Buffer.alloc(len);
    const handle = await open(path, "r");
    try {
      await handle.read(buf, 0, len, start);
    } finally {
      await handle.close();
    }
    const text = buf.toString("utf8");
    const lastNl = text.lastIndexOf("\n");
    // Render everything up to the last newline; carry any trailing partial line
    // forward so a follow-up write that completes it parses cleanly.
    send(renderTail(lastNl === -1 ? text : text.slice(0, lastNl)));
    buffer = lastNl === -1 ? text : text.slice(lastNl + 1);
    offset = size;
  } catch {
    send(`${DIM}(could not read transcript tail)${RESET}\r\n`);
  }

  let reading = false;
  let pending = false;

  async function drain(): Promise<void> {
    if (reading) {
      pending = true;
      return;
    }
    reading = true;
    try {
      let size: number;
      try {
        ({ size } = await stat(path!));
      } catch {
        return;
      }
      // File replaced/truncated (rare — transcripts are append-only): resume
      // from the new end and drop any half-line we were holding.
      if (size < offset) {
        offset = size;
        buffer = "";
      }
      if (size <= offset) return;

      const len = size - offset;
      const buf = Buffer.alloc(len);
      const handle = await open(path!, "r");
      try {
        await handle.read(buf, 0, len, offset);
      } finally {
        await handle.close();
      }
      offset = size;
      buffer += buf.toString("utf8");

      const lastNl = buffer.lastIndexOf("\n");
      if (lastNl === -1) return; // still no complete line
      const complete = buffer.slice(0, lastNl);
      buffer = buffer.slice(lastNl + 1);

      for (const line of complete.split("\n")) {
        if (!line.trim()) continue;
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        const rendered = renderTranscriptEntry(entry);
        if (rendered) send(rendered);
      }
    } finally {
      reading = false;
      if (pending) {
        pending = false;
        void drain();
      }
    }
  }

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(path, () => void drain());
  } catch {
    send(`${DIM}(could not watch transcript — mirror is static)${RESET}\r\n`);
  }

  return {
    close() {
      watcher?.close();
    },
  };
}
