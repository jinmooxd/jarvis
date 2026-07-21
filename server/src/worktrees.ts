import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorktreeInfo = {
  path: string;
  branch?: string;
  isMain: boolean;
};

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoPath,
    });
    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> | null = null;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current?.path) worktrees.push(current as WorktreeInfo);
        current = { path: line.slice("worktree ".length), isMain: worktrees.length === 0 };
      } else if (line.startsWith("branch ")) {
        if (current) current.branch = line.slice("branch ".length).replace("refs/heads/", "");
      }
    }
    if (current?.path) worktrees.push(current as WorktreeInfo);
    if (worktrees.length > 0) worktrees[0].isMain = true;
    return worktrees;
  } catch {
    return [];
  }
}
