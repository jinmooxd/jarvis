import type { SessionOrigin, SessionSummary } from "./types";

export type RepoGroup = {
  repoPath: string;
  origin: SessionOrigin;
  label: string;
  sessions: SessionSummary[];
};

export function repoName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

// Groups are keyed by origin + repo path: ~/jarvis on the Mac and on the
// droplet are different checkouts and must not merge into one group.
export function groupByRepo(sessions: SessionSummary[]): RepoGroup[] {
  const map = new Map<string, RepoGroup>();
  for (const s of sessions) {
    const origin: SessionOrigin = s.origin ?? "local";
    const repoPath = s.repoPath || "(unknown)";
    const key = `${origin}:${repoPath}`;
    if (!map.has(key)) {
      map.set(key, { repoPath, origin, label: repoName(repoPath), sessions: [] });
    }
    map.get(key)!.sessions.push(s);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.sessions.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }
  // Local groups first, then cloud; alphabetical within each.
  groups.sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === "local" ? -1 : 1;
    return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
  });
  return groups;
}

// The list in visual order, flattened across repo groups — this is what
// cmd+up/down walks, so it must match exactly what SessionList renders.
export function flattenSessions(sessions: SessionSummary[]): SessionSummary[] {
  return groupByRepo(sessions).flatMap((g) => g.sessions);
}
