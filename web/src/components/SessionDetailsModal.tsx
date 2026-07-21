import { useEffect, useState } from "react";
import { api } from "../api";
import type { SessionDetails } from "../types";

function fmtDate(ms: number | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export default function SessionDetailsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [details, setDetails] = useState<SessionDetails | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api.getDetails(id).then(setDetails).catch((e) => setError(e.message));
  }, [id]);

  const rows: [string, string][] = details
    ? [
        ["Session ID", details.claudeSessionId],
        ["Status", details.status],
        ["PID", details.pid !== undefined ? String(details.pid) : "—"],
        ["CWD", details.cwd ?? "—"],
        ["Host", details.host],
        ["Model", details.model ?? "—"],
        ["Created", fmtDate(details.createdAt)],
        ["Updated", fmtDate(details.updatedAt)],
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-panel w-full max-w-md rounded-2xl border border-white/10 p-5 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold tracking-wide text-neutral-200">
            {details?.name ?? "Session details"}
          </h2>
          <button onClick={onClose} className="rounded-md px-2 py-0.5 text-neutral-500 transition hover:bg-white/10 hover:text-neutral-200">
            ✕
          </button>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
        {!details && !error && <div className="text-xs text-neutral-600">Loading…</div>}
        {details && (
          <dl className="space-y-2">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-3">
                <dt className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                  {label}
                </dt>
                <dd className="break-all font-mono text-xs text-neutral-200">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
