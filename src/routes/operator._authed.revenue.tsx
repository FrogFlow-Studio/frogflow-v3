import { createFileRoute, Link } from "@tanstack/react-router";
import { revenueFn } from "@/app/operator/operator.functions";
import { Badge, Card, Empty, PageTitle, Stat } from "@/app/ui";
import { TIER_TITLES, PLAN_TIERS } from "@/core/plans/registry";
import { ChartCard, DataTable, LineChart } from "@/app/ui/charts";
import type { RevenueState } from "@/core/plans/revenue";

export const Route = createFileRoute("/operator/_authed/revenue")({
  loader: () => revenueFn(),
  component: RevenuePage,
});

const tg = (n: number) => `${n.toLocaleString("ru")} ₸`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru") : "—");

const STATE: Record<RevenueState, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  paying: { label: "платит", tone: "ok" },
  trial: { label: "пробный", tone: "warn" },
  overdue: { label: "просрочен", tone: "danger" },
  no_plan: { label: "без плана", tone: "neutral" },
};

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const monthTitle = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/**
 * Выручка платформы. MRR — по планам платящих клиентов (подписка и каналы,
 * годовая оплата — 10/12 в месяц); подключение разовое и видно только в
 * поступлениях. Поступления — фактические платежи из «Подписки и счета».
 */
function RevenuePage() {
  const {
    summary: s,
    cashByTier,
    renewals,
    renewalsExpected,
    churn,
    clients,
  } = Route.useLoaderData();
  return (
    <>
      <PageTitle
        title="Выручка"
        subtitle="Сколько платформа получает в месяц по планам клиентов и сколько денег реально пришло."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="MRR" value={tg(s.mrr)} hint={`${s.paying} платящих · ARR ${tg(s.arr)}`} />
        <Stat label="Средний чек в месяц" value={tg(s.arpu)} hint="на платящего клиента" />
        <Stat
          label="В пробном периоде"
          value={s.trial}
          hint={s.trial ? `+${tg(s.trialMrr)} к MRR, если начнут платить` : undefined}
        />
        <Stat
          label="Просрочены"
          value={s.overdue}
          hint={s.overdue ? `${tg(s.overdueMrr)} в месяц под угрозой` : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card title="MRR по планам">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>План</th>
                  <th className="text-right">Клиентов</th>
                  <th className="text-right">MRR</th>
                </tr>
              </thead>
              <tbody>
                {PLAN_TIERS.map((t) => (
                  <tr key={t}>
                    <td>{TIER_TITLES[t]}</td>
                    <td className="text-right tabular-nums">{s.byTier[t].clients}</td>
                    <td className="text-right tabular-nums">{tg(s.byTier[t].mrr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.noPlan > 0 && (
            <p className="mt-2 text-xs text-muted">
              Без плана с ценой (нет плана или индивидуальные условия): {s.noPlan}.
            </p>
          )}
        </Card>
        <ChartCard
          title="Поступления по месяцам и тарифам"
          chart={
            <>
              <LineChart
                points={cashByTier.map((r) => ({ x: r.month, y: r.total }))}
                format={tg}
                labelX={monthTitle}
              />
              <p className="mt-2 text-xs text-muted">
                Только оплаченные платежи в тенге: подписка, каналы и подключение. Нулевые платежи
                пробного периода не считаются. Разбивка по тарифам — в таблице.
              </p>
            </>
          }
          table={
            <>
              <DataTable
                head={["Месяц", "Платежей", "Basic", "Pro", "Business", "Другое", "Всего"]}
                rows={[...cashByTier]
                  .reverse()
                  .map((r) => [
                    monthTitle(r.month),
                    r.count,
                    tg(r.basic),
                    tg(r.pro),
                    tg(r.business),
                    tg(r.other),
                    tg(r.total),
                  ])}
              />
              <p className="mt-2 text-xs text-muted">
                Тариф платежа — текущий тариф клиента: прошлые тарифы не хранятся. «Другое» —
                клиенты на индивидуальных условиях или без плана.
              </p>
            </>
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card title="Продления в ближайшие 14 дней">
          {renewals.length === 0 ? (
            <Empty>Срок ни у одного платящего клиента не кончается в ближайшие 14 дней.</Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Клиент</th>
                      <th>Срок до</th>
                      <th className="text-right">Ожидается</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renewals.map((r) => (
                      <tr key={r.botId}>
                        <td>
                          <Link
                            to="/operator/clients/$botId"
                            params={{ botId: r.botId }}
                            className="font-medium hover:underline"
                          >
                            {r.name}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap text-muted">
                          {day(r.expiresAt)}
                          <span className="ml-2 text-xs">
                            {r.daysLeft === 0 ? "сегодня" : `через ${r.daysLeft} дн.`}
                          </span>
                        </td>
                        <td className="text-right tabular-nums">{tg(r.expected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-sm">
                Ожидается, если все продлят: <b className="tabular-nums">{tg(renewalsExpected)}</b>
              </p>
            </>
          )}
          <p className="mt-2 text-xs text-muted">
            Платящие клиенты на плане с ценой; сумма — за следующий период (месяц или год) по их
            плану.
          </p>
        </Card>
        <Card title="Отток за 30 дней">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Ушли" value={churn.clients.length} />
            <Stat label="MRR ушёл" value={tg(churn.lostMrr)} />
            <Stat label="Доля" value={churn.ratePct === null ? "—" : `${churn.ratePct}%`} />
          </div>
          {churn.clients.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table mt-3">
                <thead>
                  <tr>
                    <th>Клиент</th>
                    <th>Срок кончился</th>
                    <th className="text-right">В месяц</th>
                  </tr>
                </thead>
                <tbody>
                  {churn.clients.map((c) => (
                    <tr key={c.botId}>
                      <td>
                        <Link
                          to="/operator/clients/$botId"
                          params={{ botId: c.botId }}
                          className="font-medium hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-muted">{day(c.expiresAt)}</td>
                      <td className="text-right tabular-nums">{c.monthly ? tg(c.monthly) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            Ушёл — тот, у кого оплаченный срок кончился за последние 30 дней и не продлён. Кто не
            заплатил после пробного периода, не считается. Доля — от платящих сейчас и ушедших.
          </p>
        </Card>
      </div>

      <Card title="Клиенты на планах" className="mt-4">
        {clients.length === 0 ? (
          <Empty>Ни у одного клиента пока нет плана.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>План</th>
                  <th>Состояние</th>
                  <th>Оплачено до</th>
                  <th className="text-right">В месяц</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.botId}>
                    <td>
                      <Link
                        to="/operator/clients/$botId"
                        params={{ botId: c.botId }}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td>{c.plan}</td>
                    <td>
                      <Badge tone={STATE[c.state].tone}>{STATE[c.state].label}</Badge>
                    </td>
                    <td className="whitespace-nowrap text-muted">
                      {day(c.state === "trial" ? c.trialUntil : c.expiresAt)}
                    </td>
                    <td className="text-right tabular-nums">{c.monthly ? tg(c.monthly) : "—"}</td>
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
