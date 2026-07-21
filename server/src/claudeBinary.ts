import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cached: string | null | undefined;

export async function resolveClaudeBinary(): Promise<string | undefined> {
  if (cached !== undefined) return cached ?? undefined;
  try {
    const { stdout } = await execFileAsync("which", ["claude"]);
    cached = stdout.trim() || null;
  } catch {
    cached = null;
  }
  return cached ?? undefined;
}
