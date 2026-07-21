import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = homedir();
export const CLAUDE_JSON_PATH = join(HOME, ".claude.json");
export const CLAUDE_DIR = join(HOME, ".claude");
export const DATA_DIR = join(import.meta.dirname, "..", "data");
export const SESSIONS_STORE_PATH = join(DATA_DIR, "sessions.json");

export const PORT = Number(process.env.PORT ?? 3001);
// 127.0.0.1 by default; set HOST=0.0.0.0 (behind a firewall/Tailscale) to
// reach jarvis from other devices, e.g. a phone.
export const HOST = process.env.HOST ?? "127.0.0.1";
export const WEB_DIST = join(import.meta.dirname, "..", "..", "web", "dist");

// Heuristic: models tagged with a 1M-token context window carry "1m" in
// their id/value (e.g. "claude-fable-5[1m]", "sonnet-1m"). Everything else
// defaults to the standard 200k window.
export function contextWindowForModel(model: string | undefined, oneMillionContext?: boolean): number {
  if (oneMillionContext) return 1_000_000;
  if (model && /1m/i.test(model)) return 1_000_000;
  return 200_000;
}

export function colorForContextPct(pct: number): "green" | "yellow" | "orange" | "red" {
  if (pct <= 30) return "green";
  if (pct <= 45) return "yellow";
  if (pct <= 60) return "orange";
  return "red";
}
