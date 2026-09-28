import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { partnerReportFn } from "@/app/partner/partner.functions";
import { Card, Empty, PageTitle } from "@/app/ui";

/** Отчёт агентства-партнёра по подписанной ссылке (core/partners): свои клиенты и комиссия. */
export const Route = createFileRoute("/partner/$code")({
  validateSearch: z.object({ t: z.string().max(64).catch("") }),
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: ({ params, deps }) => partnerReportFn({ data: { code: params.code, t: deps.t } }),
  head: () => ({
    meta: [{ title: "FrogFlow · Отчёт партнёра" }, { name: "robots", content: "noindex" }],
  }),
  errorComponent: () => (
    <main className="mx-auto max-w-sm px-4 py-20 text-center text-sm text-muted">
      Ссылка недействительна — попросите новую у FrogFlow.
    </main>
  ),
  component: PartnerPage,
});

const money = (n: number, cur: string) => `${n.toLocaleString("ru")} ${cur}`;

function PartnerPage() {
  const r = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-10">
      <PageTitle
        title={`${r.partner.name} · партнёр FrogFlow`}
        subtitle={`Ваша комиссия — ${r.partner.percent}% с оплат подписки приведённых клиентов, за последние 12 месяцев.`}
      />
      <Card title="Итого">
        {r.totals.length === 0 ? (
          <Empty>Оплат пока нет.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {r.totals.map((x) => (
              <li key={x.currency}>
                Оплачено клиентами {money(x.paid, x.currency)} · ваша комиссия{" "}
                <b>{money(x.commission, x.currency)}</b>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="По месяцам">
        {r.months.length === 0 ? (
          <Empty>—</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Месяц</th>
                <th className="text-right">Оплачено</th>
                <th className="text-right">Комиссия</th>
              </tr>
            </thead>
            <tbody>
              {r.months.map((m) => (
                <tr key={`${m.month}-${m.currency}`}>
                  <td>{m.month}</td>
                  <td className="text-right tabular-nums">{money(m.paid, m.currency)}</td>
                  <td className="text-right tabular-nums">{money(m.commission, m.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title={`Клиенты (${r.clients.length})`}>
        {r.clients.length === 0 ? (
          <Empty>Клиентов пока нет.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Магазин</th>
                <th>План</th>
                <th className="text-right">Оплачено</th>
              </tr>
            </thead>
            <tbody>
              {r.clients.map((c) => (
                <tr key={c.botId}>
                  <td>{c.name}</td>
                  <td>{c.plan}</td>
                  <td className="text-right tabular-nums">
                    {Object.entries(c.paid)
                      .map(([cur, n]) => money(n, cur))
                      .join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}
