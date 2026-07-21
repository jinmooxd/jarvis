import { readFile } from "node:fs/promises";
import { CLAUDE_JSON_PATH } from "./config.js";

export type ModelOption = {
  value: string;
  label: string;
  description?: string;
};

let cachedRaw: any | null = null;
let cachedAt = 0;
const CACHE_MS = 5000;

async function readClaudeJson(): Promise<any> {
  const now = Date.now();
  if (cachedRaw && now - cachedAt < CACHE_MS) return cachedRaw;
  const text = await readFile(CLAUDE_JSON_PATH, "utf-8");
  cachedRaw = JSON.parse(text);
  cachedAt = now;
  return cachedRaw;
}

export async function listKnownRepos(): Promise<string[]> {
  try {
    const cfg = await readClaudeJson();
    const projects = cfg.projects ?? {};
    return Object.keys(projects).sort();
  } catch {
    return [];
  }
}

// "opus"/"sonnet" are CLI-documented aliases that always resolve to the
// latest model in that family, so they're safe to offer unconditionally.
// Anything more specific (Fable, extended-context variants, etc.) comes from
// the account's live additionalModelOptionsCache rather than being
// hardcoded, since exact model-id strings change over time and guessing
// wrong ones would produce a dropdown option that fails at spawn time.
const BASELINE_MODELS: ModelOption[] = [
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
];

export async function listModelOptions(): Promise<ModelOption[]> {
  const seen = new Set(BASELINE_MODELS.map((m) => m.value));
  const out = [...BASELINE_MODELS];
  try {
    const cfg = await readClaudeJson();
    const cache = cfg.additionalModelOptionsCache;
    const options: ModelOption[] = Array.isArray(cache)
      ? cache
      : Array.isArray(cache?.options)
        ? cache.options
        : [];
    for (const opt of options) {
      if (opt?.value && !seen.has(opt.value)) {
        seen.add(opt.value);
        out.push({ value: opt.value, label: opt.label ?? opt.value, description: opt.description });
      }
    }
  } catch {
    // fall through to baseline-only list
  }
  return out;
}
