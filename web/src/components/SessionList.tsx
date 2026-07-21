import { useMemo, useState } from "react";
import { api } from "../api";
import { groupByRepo } from "../sessionGroups";
import type { SessionSummary } from "../types";
import ContextBadge from "./ContextBadge";
import SessionDetailsModal from "./SessionDetailsModal";

const STATUS_COLOR: Record<string, string> = {
  live: "bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.7)]",
  cold: "bg-neutral-600",
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function SessionList({
  sessions,
  selectedId,
  onSelect,
  onCreate,
  onRefresh,
}: {
  sessions: SessionSummary[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [menuId, setMenuId] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editValue, setEditValue] = useState("");
  const [detailsId, setDetailsId] = useState<string | undefined>();
  const [stopping, setStopping] = useState(false);

  const groups = useMemo(() => {
    const all = groupByRepo(sessions);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    // Search only reaches sessions we still have open (not cold) — closed
    // sessions have to be found by browsing, not searched.
    return all
      .map((g) => ({
        ...g,
        sessions: g.sessions.filter((s) => s.status !== "cold" && s.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.sessions.length > 0);
  }, [sessions, query]);

  function toggle(repoPath: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(repoPath)) next.delete(repoPath);
      else next.add(repoPath);
      return next;
    });
  }

  function toggleChecked(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function stopChecked() {
    setStopping(true);
    try {
      await Promise.all([...checked].map((id) => api.killSession(id).catch(() => {})));
      setChecked(new Set());
      onRefresh();
    } finally {
      setStopping(false);
    }
  }

  function startRename(s: SessionSummary) {
    setMenuId(undefined);
    setEditingId(s.claudeSessionId);
    setEditValue(s.name);
  }

  async function commitRename() {
    const id = editingId;
    const name = editValue.trim();
    setEditingId(undefined);
    if (!id || !name) return;
    await api.renameSession(id, name).catch(() => {});
    onRefresh();
  }

  async function closeSession(id: string) {
    setMenuId(undefined);
    if (!window.confirm("Close this session? It will be stopped and removed from the list. /resume-ing it later brings it back.")) return;
    await api.closeSession(id).catch(() => {});
    setChecked((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    onRefresh();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 py-3">
        <span className="text-[13px] font-medium tracking-wide text-neutral-300">Sessions</span>
        <div className="flex items-center gap-2">
          {checked.size > 0 && (
            <button
              onClick={stopChecked}
              disabled={stopping}
              className="rounded-lg bg-red-400/15 px-2.5 py-1 text-xs font-medium text-red-300 ring-1 ring-inset ring-red-400/30 transition hover:bg-red-400/25 active:scale-[0.97] disabled:opacity-50"
            >
              {stopping ? "Stopping…" : `Stop (${checked.size})`}
            </button>
          )}
          <button
            onClick={onCreate}
            className="rounded-lg bg-neutral-100/90 px-2.5 py-1 text-xs font-medium text-neutral-900 shadow-sm transition hover:bg-white active:scale-[0.97]"
          >
            + Create
          </button>
        </div>
      </div>

      <div className="border-b border-white/8 px-3 py-2.5">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search open sessions…"
            className="w-full rounded-lg border border-white/8 bg-black/25 py-1.5 pl-8 pr-2.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-white/20 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {groups.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-neutral-600">
            {query ? "No open sessions match" : "No sessions yet"}
          </div>
        )}
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.repoPath);
          return (
            <div key={g.repoPath} className="px-1.5 pt-1.5">
              <button
                onClick={() => toggle(g.repoPath)}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition hover:bg-white/5"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={`h-2.5 w-2.5 shrink-0 text-neutral-500 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                >
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  {g.label}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-neutral-600">{g.sessions.length}</span>
              </button>

              {!isCollapsed && (
                <div className="ml-2.5 border-l border-white/8 pl-1.5">
                  {g.sessions.map((s) => {
                    const id = s.claudeSessionId;
                    const isChecked = checked.has(id);
                    const isEditing = editingId === id;
                    return (
                      <div
                        key={id}
                        role="button"
                        tabIndex={0}
                        onClick={() => !isEditing && onSelect(id)}
                        onKeyDown={(e) => e.key === "Enter" && !isEditing && onSelect(id)}
                        className={`group relative block w-full cursor-pointer rounded-lg px-2 py-2 text-left transition-colors ${
                          selectedId === id ? "bg-white/10 shadow-inner" : "hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleChecked(id);
                            }}
                            aria-label="Select session"
                            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[9px] leading-none transition ${
                              isChecked
                                ? "border-neutral-200 bg-neutral-100 text-neutral-900 opacity-100"
                                : "border-white/25 text-transparent opacity-0 hover:border-white/50 group-hover:opacity-100"
                            }`}
                          >
                            ✓
                          </button>
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_COLOR[s.status] ?? "bg-neutral-600"}`} />
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename();
                                if (e.key === "Escape") setEditingId(undefined);
                              }}
                              onBlur={commitRename}
                              className="w-full rounded border border-white/20 bg-black/40 px-1 py-0.5 text-[13px] text-neutral-100 focus:outline-none"
                            />
                          ) : (
                            <span className="truncate pr-5 text-[13px] font-medium text-neutral-200">{s.name}</span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuId(menuId === id ? undefined : id);
                            }}
                            aria-label="Session menu"
                            className={`absolute right-1.5 top-1.5 rounded-md px-1 text-neutral-400 transition hover:bg-white/10 hover:text-neutral-200 ${
                              menuId === id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                            }`}
                          >
                            ⋯
                          </button>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 pl-6">
                          <span className="text-[10.5px] text-neutral-600">
                            {s.gitBranch ?? ""} · {relativeTime(s.lastModified)}
                          </span>
                          <ContextBadge context={s.context} />
                        </div>

                        {menuId === id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuId(undefined); }} />
                            <div
                              className="glass-panel absolute right-1.5 top-7 z-20 w-36 overflow-hidden rounded-lg border border-white/10 py-1 shadow-xl shadow-black/50"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => startRename(s)}
                                className="block w-full px-3 py-1.5 text-left text-xs text-neutral-200 transition hover:bg-white/10"
                              >
                                Rename
                              </button>
                              <button
                                onClick={() => {
                                  setMenuId(undefined);
                                  setDetailsId(id);
                                }}
                                className="block w-full px-3 py-1.5 text-left text-xs text-neutral-200 transition hover:bg-white/10"
                              >
                                Details
                              </button>
                              <button
                                onClick={() => closeSession(id)}
                                className="block w-full px-3 py-1.5 text-left text-xs text-red-300 transition hover:bg-red-400/15"
                              >
                                Close Session
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {detailsId && <SessionDetailsModal id={detailsId} onClose={() => setDetailsId(undefined)} />}
    </div>
  );
}
