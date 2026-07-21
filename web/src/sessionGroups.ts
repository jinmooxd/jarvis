import type { SessionSummary } from "./types";

export type RepoGroup = {
  repoPath: string;
  label: string;
  sessions: SessionSummary[];
};

export function repoName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function groupByRepo(sessions: SessionSummary[]): RepoGroup[] {
  const map = new Map<string, RepoGroup>();
  for (const s of sessions) {
    const key = s.repoPath || "(unknown)";
    if (!map.has(key)) {
      map.set(key, { repoPath: key, label: repoName(key), sessions: [] });
    }
    map.get(key)!.sessions.push(s);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.sessions.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }
  groups.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  return groups;
}

// The list in visual order, flattened across repo groups — this is what
// cmd+up/down walks, so it must match exactly what SessionList renders.
export function flattenSessions(sessions: SessionSummary[]): SessionSummary[] {
  return groupByRepo(sessions).flatMap((g) => g.sessions);
}
