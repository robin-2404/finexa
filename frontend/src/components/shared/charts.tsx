import type { ReactNode } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const CHART = {
  teal: "#0b7f8a",
  tealSoft: "#8fcfd5",
  amber: "#d98a1c",
  red: "#c62f3e",
  green: "#2c8a5a",
  grid: "#e4eaf1",
  axis: "#5b6b7f",
  navy: "#12264a",
};

export const axisProps = { tick: { fontSize: 11, fill: CHART.axis }, tickLine: false, axisLine: { stroke: CHART.grid } } as const;

/** Tooltip card used by every chart, so hover content is consistent and readable. */
export function ChartTip({ active, payload, title, rows }: { active?: boolean; payload?: readonly any[]; title: (p: any) => ReactNode; rows: (p: any) => { label: string; value: ReactNode; color?: string }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 text-xs shadow-pop">
      <p className="mb-1.5 font-semibold text-foreground">{title(p)}</p>
      <dl className="space-y-1">
        {rows(p).map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-6">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              {r.color && <span className="size-2 rounded-sm" style={{ background: r.color }} aria-hidden />}
              {r.label}
            </dt>
            <dd className="tabular font-medium text-foreground">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Chart legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
