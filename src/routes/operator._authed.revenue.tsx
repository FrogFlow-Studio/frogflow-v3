import { createFileRoute, Link } from "@tanstack/react-router";
import { revenueFn } from "@/app/operator/operator.functions";
import { Badge, Card, Empty, PageTitle, Stat } from "@/app/ui";
import { TIER_TITLES, PLAN_TIERS } from "@/core/plans/registry";
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
  const { summary: s, cash, clients } = Route.useLoaderData();
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="MRR по планам">
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
          {s.noPlan > 0 && (
            <p className="mt-2 text-xs text-muted">
              Без плана с ценой (нет плана или индивидуальные условия): {s.noPlan}.
            </p>
          )}
        </Card>
        <Card title="Поступления по месяцам">
          <table className="table">
            <thead>
              <tr>
                <th>Месяц</th>
                <th className="text-right">Платежей</th>
                <th className="text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {[...cash].reverse().map((r) => (
                <tr key={r.month}>
                  <td>{monthTitle(r.month)}</td>
                  <td className="text-right tabular-nums">{r.count}</td>
                  <td className="text-right tabular-nums">{tg(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            Подписка, каналы и подключение, в тенге. Нулевые платежи пробного периода не считаются.
          </p>
        </Card>
      </div>

      <Card title="Клиенты на планах" className="mt-4">
        {clients.length === 0 ? (
          <Empty>Ни у одного клиента пока нет плана.</Empty>
        ) : (
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
        )}
      </Card>
    </>
  );
}
