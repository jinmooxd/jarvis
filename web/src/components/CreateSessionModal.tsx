import { useEffect, useState } from "react";
import { apiFor } from "../api";
import type { CloudStatus, ModelOption, SessionOrigin, WorktreeChoice, WorktreeInfo } from "../types";

const fieldCls =
  "w-full rounded-lg border border-white/8 bg-black/25 px-2.5 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-white/25 focus:outline-none";
const ghostBtnCls =
  "shrink-0 rounded-lg border border-white/8 px-2 text-xs text-neutral-400 transition hover:bg-white/5 hover:text-neutral-200";

export default function CreateSessionModal({
  cloud,
  onClose,
  onCreated,
}: {
  cloud: CloudStatus;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [origin, setOrigin] = useState<SessionOrigin>("local");
  const [repos, setRepos] = useState<string[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);

  const [repoPath, setRepoPath] = useState("");
  const [customRepo, setCustomRepo] = useState("");
  const [useCustomRepo, setUseCustomRepo] = useState(false);
  const [model, setModel] = useState("");
  const [oneMillionContext, setOneMillionContext] = useState(false);
  const [worktreeChoice, setWorktreeChoice] = useState<string>("main");
  const [newWorktreeName, setNewWorktreeName] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Repos, models, and worktrees all come from the machine the session will
  // run on, so everything refetches when the location toggles.
  useEffect(() => {
    setRepos([]);
    setModels([]);
    setRepoPath("");
    apiFor(origin)
      .listRepos()
      .then((r) => {
        setRepos(r);
        if (r.length > 0) setRepoPath(r[0]);
      })
      .catch(() => setRepos([]));
    apiFor(origin)
      .listModels()
      .then((m) => {
        setModels(m);
        if (m.length > 0) setModel(m[0].value);
      })
      .catch(() => setModels([]));
  }, [origin]);

  const effectiveRepo = useCustomRepo ? customRepo : repoPath;

  useEffect(() => {
    if (!effectiveRepo) {
      setWorktrees([]);
      return;
    }
    apiFor(origin).listWorktrees(effectiveRepo).then(setWorktrees).catch(() => setWorktrees([]));
    setWorktreeChoice("main");
  }, [effectiveRepo, origin]);

  async function handleSubmit() {
    if (!effectiveRepo || !model || !name.trim()) {
      setError("Name, repo, and model are required");
      return;
    }
    let worktree: WorktreeChoice | undefined;
    if (worktreeChoice === "new") {
      if (!newWorktreeName.trim()) {
        setError("Enter a name for the new worktree");
        return;
      }
      worktree = { mode: "new", name: newWorktreeName.trim() };
    } else if (worktreeChoice !== "main") {
      worktree = { mode: "existing", path: worktreeChoice };
    }

    setSubmitting(true);
    setError(undefined);
    try {
      const { claudeSessionId } = await apiFor(origin).createSession({
        name: name.trim(),
        repoPath: effectiveRepo,
        model,
        oneMillionContext,
        worktree,
      });
      onCreated(claudeSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-md rounded-2xl border border-white/10 p-5 shadow-2xl shadow-black/50">
        <h2 className="mb-4 text-[13px] font-semibold tracking-wide text-neutral-200">New Session</h2>

        <div className="space-y-3.5">
          {cloud.configured && (
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                Location
              </label>
              <div className="flex overflow-hidden rounded-lg border border-white/8">
                {(["local", "cloud"] as const).map((o) => {
                  const disabled = o === "cloud" && !cloud.connected;
                  return (
                    <button
                      key={o}
                      onClick={() => !disabled && setOrigin(o)}
                      disabled={disabled}
                      title={disabled ? "Cloud is disconnected — reconnect from the session list" : undefined}
                      className={`flex-1 px-2.5 py-1.5 text-xs font-medium transition ${
                        origin === o
                          ? "bg-neutral-100/90 text-neutral-900"
                          : "bg-black/25 text-neutral-400 hover:bg-white/5 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-black/25"
                      }`}
                    >
                      {o === "local" ? "This machine" : "Cloud ☁"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. fix-auth-bug"
              className={fieldCls}
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              Repository
            </label>
            {!useCustomRepo ? (
              <div className="flex gap-2">
                <select value={repoPath} onChange={(e) => setRepoPath(e.target.value)} className={fieldCls}>
                  {repos.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button onClick={() => setUseCustomRepo(true)} className={ghostBtnCls}>
                  Other…
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={customRepo}
                  onChange={(e) => setCustomRepo(e.target.value)}
                  placeholder="/absolute/path/to/repo"
                  className={fieldCls}
                />
                <button onClick={() => setUseCustomRepo(false)} className={ghostBtnCls}>
                  List
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              Worktree
            </label>
            <select value={worktreeChoice} onChange={(e) => setWorktreeChoice(e.target.value)} className={fieldCls}>
              <option value="main">Main checkout</option>
              {worktrees
                .filter((w) => !w.isMain)
                .map((w) => (
                  <option key={w.path} value={w.path}>
                    {w.branch ?? w.path}
                  </option>
                ))}
              <option value="new">+ New worktree…</option>
            </select>
            {worktreeChoice === "new" && (
              <input
                value={newWorktreeName}
                onChange={(e) => setNewWorktreeName(e.target.value)}
                placeholder="branch/worktree name"
                className={`mt-2 ${fieldCls}`}
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              Model
            </label>
            <select value={model} onChange={(e) => setModel(e.target.value)} className={fieldCls}>
              {models.map((m) => (
                <option key={m.value} value={m.value} title={m.description}>
                  {m.label}
                </option>
              ))}
            </select>
            <label className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
              <input
                type="checkbox"
                checked={oneMillionContext}
                onChange={(e) => setOneMillionContext(e.target.checked)}
                className="accent-neutral-300"
              />
              1M context window (if supported by this model)
            </label>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 transition hover:bg-white/5 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-neutral-100/90 px-3.5 py-1.5 text-xs font-medium text-neutral-900 shadow-sm transition hover:bg-white disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
