import { createFileRoute } from "@tanstack/react-router";
import { platformHealthFn } from "@/app/operator/operator.functions";
import type { HealthRow, Light } from "@/app/operator/platform-health";
import { Badge, PageTitle } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/health")({
  loader: () => platformHealthFn(),
  component: HealthPage,
});

const LIGHT: Record<Light, { tone: "ok" | "warn" | "danger" | "neutral"; label: string }> = {
  green: { tone: "ok", label: "зелёный" },
  unknown: { tone: "neutral", label: "нет данных" },
  yellow: { tone: "warn", label: "жёлтый" },
  red: { tone: "danger", label: "красный" },
};

function Rows({ title, rows }: { title: string; rows: HealthRow[] }) {
  return (
    <div className="card mb-4 overflow-x-auto">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <table className="table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="w-24">
                <Badge tone={LIGHT[r.light].tone}>{LIGHT[r.light].label}</Badge>
              </td>
              <td>
                <div className="text-sm">{r.title}</div>
                <div className="text-xs text-muted">{r.detail}</div>
                {r.todo && <div className="mt-1 text-xs">Что делать: {r.todo}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Одна страница: кроны, очередь недоставленных, сбои вебхуков и каналов. */
function HealthPage() {
  const h = Route.useLoaderData();
  return (
    <>
      <PageTitle
        title="Здоровье платформы"
        subtitle={`Общий итог: ${LIGHT[h.overall].label}. Снято ${new Date(h.at).toLocaleString("ru", { dateStyle: "short", timeStyle: "medium" })}`}
      />
      <Rows title="Очереди и каналы" rows={h.queues} />
      <Rows title="Кроны" rows={h.crons} />
    </>
  );
}
