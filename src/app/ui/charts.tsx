import { useId, useState, type ReactNode } from "react";
import { Card } from "@/app/ui";
import { niceTicks } from "@/core/analytics/pure";

/*
 * Графики платформы без библиотек: SVG-линия с перекрестием и подсказкой,
 * горизонтальные полосы с подписями. У каждого графика есть табличный вид —
 * подсказка дополняет, а не заменяет чтение значений.
 */

export type Point = { x: string; y: number };

export function ChartCard({
  title,
  chart,
  table,
  className = "",
}: {
  title: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  className?: string;
}) {
  const [mode, setMode] = useState<"chart" | "table">("chart");
  return (
    <Card
      title={title}
      className={className}
      actions={
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => setMode(mode === "chart" ? "table" : "chart")}
        >
          {mode === "chart" ? "Таблица" : "График"}
        </button>
      }
    >
      {mode === "chart" ? chart : <div className="max-h-80 overflow-auto">{table}</div>}
    </Card>
  );
}

const W = 640;
const H = 220;
const PAD = { top: 14, right: 16, bottom: 26, left: 52 };

export function LineChart({
  points,
  format,
  labelX,
  color = "var(--chart-1)",
  integer = false,
}: {
  points: Point[];
  format: (v: number) => string;
  labelX: (x: string) => string;
  color?: string;
  /** Счётчики (заказы, люди): деления оси только целые. */
  integer?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const n = points.length;
  const max = Math.max(0, ...points.map((p) => p.y));
  const ticks = niceTicks(max, 4, integer);
  const top = ticks[ticks.length - 1] || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const px = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const py = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`)
    .join(" ");
  const area = n ? `${line} L${px(n - 1).toFixed(1)},${py(0)} L${px(0).toFixed(1)},${py(0)} Z` : "";
  const every = Math.max(1, Math.ceil(n / 8));
  const last = n ? points[n - 1]! : null;
  const cur = hover !== null ? points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - PAD.left) / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n - 1) - 1));
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    if (e.key === "Escape") setHover(null);
  };

  if (n === 0) return <p className="py-10 text-center text-sm text-muted">Нет данных за период</p>;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-none select-none outline-none"
        role="img"
        aria-label="График по дням"
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect x={PAD.left} y={0} width={innerW} height={H} />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={py(t)}
              y2={py(t)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={py(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--muted)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {format(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          // Последняя подпись — всегда; регулярные — если не налезают на неё.
          i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2) ? (
            <text
              key={p.x}
              x={px(i)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fontSize={11}
              fill="var(--muted)"
            >
              {labelX(p.x)}
            </text>
          ) : null,
        )}
        <g clipPath={`url(#${id}-clip)`}>
          <path d={area} fill={color} opacity={0.1} />
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
        {last && (
          <circle
            cx={px(n - 1)}
            cy={py(last.y)}
            r={4}
            fill={color}
            stroke="var(--surface)"
            strokeWidth={2}
          />
        )}
        {cur && hover !== null && (
          <g>
            <line
              x1={px(hover)}
              x2={px(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--muted)"
              strokeWidth={1}
            />
            <circle
              cx={px(hover)}
              cy={py(cur.y)}
              r={5}
              fill={color}
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      {cur && hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: `${(px(hover) / W) * 100}%`,
            transform: `translateX(${hover > n / 2 ? "calc(-100% - 8px)" : "8px"})`,
          }}
        >
          <div className="text-sm font-semibold tabular-nums">{format(cur.y)}</div>
          <div className="text-muted">{labelX(cur.x)}</div>
        </div>
      )}
    </div>
  );
}

export function BarList({
  rows,
  format,
  color = "var(--chart-1)",
}: {
  rows: Array<{ label: string; value: number; hint?: string }>;
  format: (v: number) => string;
  color?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0)
    return <p className="py-10 text-center text-sm text-muted">Нет данных за период</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate" title={r.label}>
              {r.label}
              {r.hint && <span className="ml-2 text-xs text-muted">{r.hint}</span>}
            </span>
            <span className="shrink-0 tabular-nums">{format(r.value)}</span>
          </div>
          <div className="h-2.5 rounded-r-[4px] bg-surface-2">
            <div
              className="h-full rounded-r-[4px]"
              style={{ width: `${max ? (r.value / max) * 100 : 0}%`, background: color }}
              title={`${r.label}: ${format(r.value)}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: Array<Array<ReactNode>> }) {
  return (
    <table className="table">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} className={i ? "text-right" : ""}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={j ? "text-right tabular-nums" : ""}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
