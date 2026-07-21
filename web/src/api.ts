import type { ModelOption, SessionDetails, SessionSummary, WorktreeChoice, WorktreeInfo } from "./types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  listRepos: () => jsonFetch<string[]>("/api/repos"),
  listModels: () => jsonFetch<ModelOption[]>("/api/models"),
  listWorktrees: (repo: string) => jsonFetch<WorktreeInfo[]>(`/api/worktrees?repo=${encodeURIComponent(repo)}`),
  listSessions: () => jsonFetch<SessionSummary[]>("/api/sessions"),
  killSession: (id: string) => jsonFetch<{ ok: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),
  closeSession: (id: string) => jsonFetch<{ ok: boolean }>(`/api/sessions/${id}/close`, { method: "POST" }),
  getDetails: (id: string) => jsonFetch<SessionDetails>(`/api/sessions/${id}/details`),
  renameSession: (id: string, name: string) =>
    jsonFetch<{ ok: boolean }>(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  createSession: (input: {
    name: string;
    repoPath: string;
    model: string;
    oneMillionContext?: boolean;
    worktree?: WorktreeChoice;
  }) =>
    jsonFetch<{ claudeSessionId: string }>("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
};

export function sessionSocketUrl(id: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/sessions/${id}`;
}

export function usageSocketUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/usage`;
}
