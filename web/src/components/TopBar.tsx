import { useEffect, useState } from "react";
import { usageSocketUrl } from "../api";
import type { UsageState } from "../types";
import { colorForPct } from "./ContextBadge";

const LABELS: Record<string, string> = {
  five_hour: "Session (5h)",
  seven_day: "Weekly",
  seven_day_opus: "Weekly · Opus",
  seven_day_sonnet: "Weekly · Sonnet",
  seven_day_overage_included: "Weekly · Overage",
  overage: "Overage",
};

function label(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ");
}

function pct(utilization: number | undefined): number {
  if (utilization === undefined) return 0;
  return Math.min(100, Math.max(0, utilization <= 1 ? utilization * 100 : utilization));
}

const BAR_COLOR: Record<string, string> = {
  green: "bg-emerald-400",
  yellow: "bg-amber-400",
  orange: "bg-orange-400",
  red: "bg-red-400",
};

export default function TopBar() {
  const [usage, setUsage] = useState<UsageState>({});

  useEffect(() => {
    const ws = new WebSocket(usageSocketUrl());
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.kind === "usage") setUsage(data.state);
    };
    return () => ws.close();
  }, []);

  const entries = Object.entries(usage);

  return (
    <div className="glass-panel flex items-center gap-5 overflow-x-auto border-b border-white/8 px-4 py-2.5">
      <span className="shrink-0 text-[13px] font-semibold tracking-wide text-neutral-200">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-neutral-400 align-middle" />
        jarvis
      </span>
      <div className="h-4 w-px shrink-0 bg-white/8" />
      {entries.length === 0 ? (
        <span className="text-xs text-neutral-600">Usage limits will appear once a session runs</span>
      ) : (
        entries.map(([key, bucket]) => {
          const hasUtilization = bucket?.utilization !== undefined;
          const p = pct(bucket?.utilization);
          const color = BAR_COLOR[colorForPct(p)];
          return (
            <div key={key} className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-neutral-500">{label(key)}</span>
              {hasUtilization ? (
                <>
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/8 ring-1 ring-inset ring-white/5">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${p}%` }} />
                  </div>
                  <span className="font-mono text-xs text-neutral-500">{p.toFixed(0)}%</span>
                </>
              ) : (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10.5px] text-neutral-500 ring-1 ring-inset ring-white/8">
                  {bucket?.status}
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
