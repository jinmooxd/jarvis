import type { ContextInfo } from "../types";

const COLORS: Record<string, string> = {
  green: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  yellow: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  orange: "bg-orange-400/10 text-orange-300 ring-orange-400/25",
  red: "bg-red-400/10 text-red-300 ring-red-400/25",
};

export function colorForPct(pct: number): keyof typeof COLORS {
  if (pct <= 30) return "green";
  if (pct <= 45) return "yellow";
  if (pct <= 60) return "orange";
  return "red";
}

export default function ContextBadge({ context, size = "sm" }: { context?: ContextInfo; size?: "sm" | "md" }) {
  if (!context) {
    return <span className="text-xs text-neutral-600">—</span>;
  }
  const color = colorForPct(context.pct);
  const cls = size === "md" ? "text-[13px] px-2.5 py-1" : "text-[10.5px] px-1.5 py-0.5";
  return (
    <span className={`inline-flex items-center rounded-full font-mono ring-1 ring-inset ${cls} ${COLORS[color]}`}>
      {context.pct.toFixed(0)}%
    </span>
  );
}
