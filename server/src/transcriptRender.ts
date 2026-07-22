// Pure rendering of Claude Code JSONL transcript entries into terminal text.
// No filesystem or SDK imports so it stays trivially testable and reusable by
// the read-only session mirror.

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

// How many rendered turns to show from a tail chunk.
export const TAIL_ENTRIES = 20;

function toCRLF(s: string): string {
  return s.replace(/\r?\n/g, "\r\n");
}

// Render one parsed transcript entry to displayable terminal text, or undefined
// if it carries nothing worth showing (tool plumbing, thinking, empty turns).
export function renderTranscriptEntry(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as { type?: unknown; message?: { content?: unknown } };
  const type = e.type;
  if (type !== "user" && type !== "assistant") return undefined;

  const content = e.message?.content;
  const parts: string[] = [];
  if (typeof content === "string") {
    if (content.trim()) parts.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: unknown; text?: unknown; name?: unknown };
      if (b.type === "text" && typeof b.text === "string") {
        if (b.text.trim()) parts.push(b.text);
      } else if (b.type === "tool_use") {
        // summarize the call; the actual args/results are noise in a mirror
        parts.push(`${DIM}[tool: ${typeof b.name === "string" ? b.name : "?"}]${RESET}`);
      }
      // tool_result / thinking / other block types are intentionally skipped
    }
  }

  const body = parts.join("\n").trim();
  if (!body) return undefined;

  const label =
    type === "user" ? `${BOLD}${CYAN}❯ user${RESET}` : `${BOLD}${MAGENTA}⏺ assistant${RESET}`;
  return toCRLF(`${label}\n${body}\n\n`);
}

// Render the last `maxEntries` renderable turns out of a chunk of transcript
// text. Parses newest-first, then emits oldest-first. Unparseable lines (e.g. a
// first line truncated by the tail cut, or a partial final write) are skipped.
export function renderTail(text: string, maxEntries = TAIL_ENTRIES): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < maxEntries; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const rendered = renderTranscriptEntry(entry);
    if (rendered) out.unshift(rendered);
  }
  return out.join("");
}
