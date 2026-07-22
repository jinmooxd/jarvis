import type {
  CloudStatus,
  ModelOption,
  SessionDetails,
  SessionOrigin,
  SessionSummary,
  WorktreeChoice,
  WorktreeInfo,
} from "./types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// The same API surface exists at /api (this machine) and /api/cloud (proxied
// to the cloud jarvis) — pick the base by session origin.
export function apiFor(origin: SessionOrigin = "local") {
  const p = origin === "cloud" ? "/api/cloud" : "/api";
  return {
    listRepos: () => jsonFetch<string[]>(`${p}/repos`),
    listModels: () => jsonFetch<ModelOption[]>(`${p}/models`),
    listWorktrees: (repo: string) => jsonFetch<WorktreeInfo[]>(`${p}/worktrees?repo=${encodeURIComponent(repo)}`),
    listSessions: () => jsonFetch<SessionSummary[]>(`${p}/sessions`),
    killSession: (id: string) => jsonFetch<{ ok: boolean }>(`${p}/sessions/${id}`, { method: "DELETE" }),
    closeSession: (id: string) => jsonFetch<{ ok: boolean }>(`${p}/sessions/${id}/close`, { method: "POST" }),
    getDetails: (id: string) => jsonFetch<SessionDetails>(`${p}/sessions/${id}/details`),
    renameSession: (id: string, name: string) =>
      jsonFetch<{ ok: boolean }>(`${p}/sessions/${id}`, {
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
      jsonFetch<{ claudeSessionId: string }>(`${p}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
  };
}

export const api = apiFor("local");

export const cloudApi = {
  status: () => jsonFetch<CloudStatus>("/api/cloud/status"),
  reconnect: () => jsonFetch<CloudStatus>("/api/cloud/reconnect", { method: "POST" }),
};

export function sessionSocketUrl(id: string, origin: SessionOrigin = "local"): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const path = origin === "cloud" ? "/ws/cloud/sessions/" : "/ws/sessions/";
  return `${proto}//${location.host}${path}${id}`;
}

export function usageSocketUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/usage`;
}
