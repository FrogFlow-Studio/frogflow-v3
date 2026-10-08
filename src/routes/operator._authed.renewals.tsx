import { Link, createFileRoute } from "@tanstack/react-router";
import { renewalsOverviewFn } from "@/app/operator/client-billing.functions";
import { Badge, Card, Empty, PageTitle, Stat } from "@/app/ui";

const WINDOWS = [7, 14, 30] as const;

export const Route = createFileRoute("/operator/_authed/renewals")({
  validateSearch: (s: Record<string, unknown>): { days?: number } => ({
    days: WINDOWS.find((d) => d === Number(s.days)),
  }),
  loaderDeps: ({ search }) => ({ days: search.days ?? 14 }),
  loader: ({ deps }) => renewalsOverviewFn({ data: { days: deps.days } }),
  component: RenewalsPage,
});

/** Продления: кто заканчивается в ближайшие дни и сколько ожидается. Оплату не списываем — только список и напоминания клиентам. */
function RenewalsPage() {
  const o = Route.useLoaderData();
  return (
    <>
      <PageTitle
        title="Продления"
        subtitle="Клиентам на v2 напоминание уходит само: за 7, 3 и 1 день и в день окончания, в Telegram владельца (и на почту, если он её включил). Оплату мы не списываем."
        actions={WINDOWS.map((d) => (
          <Link
            key={d}
            to="/operator/renewals"
            search={{ days: d }}
            className={d === o.withinDays ? "btn-primary" : "btn-secondary"}
          >
            {`${d} дн.`}
          </Link>
        ))}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Заканчивается в ${o.withinDays} дн.`} value={o.list.length} />
        <Stat
          label="Ожидается"
          value={`${o.expected.toLocaleString("ru")} ₸`}
          hint="по ценам плана; без плана — не считаем"
        />
        <Stat label="Без плана (цену называете сами)" value={o.noPrice} />
        <Stat label="Уже просрочено" value={o.overdue} />
      </div>
      <Card title="Кто заканчивается">
        {o.list.length === 0 ? (
          <Empty>В этом окне никто не заканчивается.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>Платформа</th>
                  <th>Конец</th>
                  <th className="text-right">Дней</th>
                  <th className="text-right">Ожидается</th>
                </tr>
              </thead>
              <tbody>
                {o.list.map((r) => (
                  <tr key={r.botId}>
                    <td>
                      <Link to="/operator/clients/$botId" params={{ botId: r.botId }}>
                        {r.name}
                      </Link>
                    </td>
                    <td>
                      {r.servedBy === "v2" ? (
                        <Badge tone="ok">v2</Badge>
                      ) : (
                        <Badge>v1 — без напоминаний от нас</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap">{r.expires}</td>
                    <td className="text-right tabular-nums">{r.daysLeft}</td>
                    <td className="text-right tabular-nums">
                      {r.amount === null ? "—" : `${r.amount.toLocaleString("ru")} ₸`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
