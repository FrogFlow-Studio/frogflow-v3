import { createFileRoute } from "@tanstack/react-router";
import { cronStatusFn } from "@/app/operator/operator.functions";
import { BUDGET_STREAK_WARN } from "@/app/operator/cron-status.shared";
import { Badge, PageTitle } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/crons")({
  loader: () => cronStatusFn(),
  component: CronsPage,
});

/** Кроны платформы: последний запуск, итог, длительность, ошибка; «молчит» — старше двух интервалов. */
function CronsPage() {
  const jobs = Route.useLoaderData();
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("ru", { dateStyle: "short", timeStyle: "medium" });
  return (
    <>
      <PageTitle
        title="Кроны"
        subtitle="Расписание из vercel.json; статус пишется самим кроном после каждого запуска"
      />
      {jobs
        .filter((j) => (j.last?.budgetStreak ?? 0) >= BUDGET_STREAK_WARN)
        .map((j) => (
          <div key={j.job} className="card mb-3 border-danger text-sm text-danger">
            {j.job}: запусков подряд с упором в бюджет времени — {j.last?.budgetStreak}, клиентов не
            хватает одного запуска. Следующие запуски продолжают с отложенных; если так остаётся,
            расписание крона надо учащать.
          </div>
        ))}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Задача</th>
              <th>Расписание</th>
              <th>Последний запуск</th>
              <th>Итог</th>
              <th className="text-right">Длительность</th>
              <th className="text-right">Клиентов</th>
              <th>Сводка / ошибка</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.job}>
                <td>
                  <div className="font-mono text-sm">{j.job}</div>
                  <div className="text-xs text-muted">{j.title}</div>
                </td>
                <td className="font-mono text-xs text-muted">{j.schedule}</td>
                <td className="whitespace-nowrap text-muted">{j.last ? fmt(j.last.at) : "—"}</td>
                <td>
                  {!j.last ? (
                    <Badge>не запускался</Badge>
                  ) : j.stale ? (
                    <Badge tone="danger">молчит</Badge>
                  ) : j.last.ok ? (
                    <Badge tone="ok">ок</Badge>
                  ) : (
                    <Badge tone="danger">ошибка</Badge>
                  )}
                </td>
                <td className="text-right tabular-nums">
                  {j.last ? `${(j.last.durationMs / 1000).toFixed(1)} с` : "—"}
                </td>
                <td className="text-right tabular-nums">{j.last?.tenants ?? "—"}</td>
                <td className="max-w-md">
                  {j.last?.resume && (
                    <div className="text-xs text-muted">
                      Бюджет вышел: отложено клиентов {j.last.skipped ?? "?"}, следующий запуск
                      продолжит с {j.last.resume}
                    </div>
                  )}
                  {j.last?.error && <div className="text-xs text-danger">{j.last.error}</div>}
                  {j.last?.summary && (
                    <pre className="max-h-24 overflow-auto text-xs whitespace-pre-wrap text-muted">
                      {j.last.summary}
                    </pre>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
