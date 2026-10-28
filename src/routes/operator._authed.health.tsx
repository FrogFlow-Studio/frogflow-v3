import { createFileRoute } from "@tanstack/react-router";
import { platformHealthFn } from "@/app/operator/platform.functions";
import type { HealthRow, Light } from "@/app/operator/platform-health";
import { Badge, PageTitle } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/health")({
  loader: () => platformHealthFn(),
  component: HealthPage,
});

const LIGHT: Record<Light, { tone: "ok" | "warn" | "danger" | "neutral"; label: string }> = {
  green: { tone: "ok", label: "работает" },
  unknown: { tone: "neutral", label: "нет данных" },
  yellow: { tone: "warn", label: "внимание" },
  red: { tone: "danger", label: "сбой" },
};

function Rows({ title, rows }: { title: string; rows: HealthRow[] }) {
  return (
    <section className="operator-health-group">
      <h2>{title}</h2>
      <div className="operator-health-list">
        {[...rows]
          .sort(
            (a, b) =>
              ({ red: 0, unknown: 1, yellow: 2, green: 3 })[a.light] -
              { red: 0, unknown: 1, yellow: 2, green: 3 }[b.light],
          )
          .map((r) => (
            <article key={r.id}>
              <div>
                <h3>{r.title}</h3>
                <p>{r.detail}</p>
                {r.todo && <p className="operator-health-todo">Что делать: {r.todo}</p>}
              </div>
              <Badge tone={LIGHT[r.light].tone}>{LIGHT[r.light].label}</Badge>
            </article>
          ))}
      </div>
    </section>
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
