import { createFileRoute, Link } from "@tanstack/react-router";
import { listClientsFn } from "@/app/operator/clients.functions";
import { isPaymentSoon, isProblem, lastError } from "@/app/operator/client-health";
import { TodayTasks } from "@/app/operator/client/notes";
import { supportInboxFn } from "@/app/operator/support.functions";
import { Badge, Empty } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/")({
  loader: async () => {
    const [clients, inbox] = await Promise.all([
      listClientsFn(),
      supportInboxFn({ data: {} }).catch(() => null),
    ]);
    return { clients, inbox };
  },
  component: OperatorOverview,
});

function OperatorOverview() {
  const { clients, inbox } = Route.useLoaderData();
  const { pendingRequests } = Route.useRouteContext();
  const problems = clients.filter(isProblem);
  const paymentSoon = clients.filter(isPaymentSoon);
  const quiet = clients.filter((c) => c.pulse?.quiet && !isProblem(c));
  const actionClients = [
    ...problems,
    ...quiet,
    ...paymentSoon.filter((c) => !problems.includes(c) && !quiet.includes(c)),
  ];
  const unread = clients.filter(
    (c) => c.statsUnread || c.debtUnread || (c.servedBy === "v2" && !c.pulse),
  );
  return (
    <div className="operator-overview">
      <div className="operator-hero">
        <div>
          <p className="operator-kicker">Рабочий стол</p>
          <h1>Что требует внимания сегодня</h1>
          <p>
            Сигналы по клиентам и задачи в одном месте. Откройте клиента, чтобы принять решение.
          </p>
        </div>
        <Link to="/operator/clients/new" className="btn-primary">
          Подключить клиента
        </Link>
      </div>
      <div className="operator-signal-grid">
        <Link
          to="/operator/clients"
          search={{ view: "problem" }}
          className="operator-signal operator-signal-danger"
        >
          <strong>{problems.length}</strong>
          <span>Проблемы клиентов</span>
          <small>Каналы и просроченные подписки</small>
        </Link>
        <Link to="/operator/requests" className="operator-signal operator-signal-warn">
          <strong>{pendingRequests}</strong>
          <span>Заявки на модули</span>
          <small>Запросы владельцев магазинов</small>
        </Link>
        <Link to="/operator/support" className="operator-signal">
          <strong>{inbox ? inbox.rows.filter((r) => r.unread > 0).length : "—"}</strong>
          <span>Поддержка</span>
          <small>
            {inbox ? "Диалоги с непрочитанными сообщениями" : "Данные поддержки недоступны"}
          </small>
        </Link>
        <Link to="/operator/renewals" className="operator-signal">
          <strong>{paymentSoon.length}</strong>
          <span>Оплата скоро</span>
          <small>Подписки в ближайшие 14 дней</small>
        </Link>
      </div>
      <div className="operator-overview-columns">
        <section>
          <div className="operator-section-heading">
            <h2>Клиенты, которым нужна помощь</h2>
            <Link to="/operator/clients">Все клиенты</Link>
          </div>
          {actionClients.length === 0 ? (
            <Empty>Сейчас нет клиентов с известными проблемами или приближающейся оплатой.</Empty>
          ) : (
            <div className="operator-queue">
              {actionClients.slice(0, 8).map((c) => {
                const reason =
                  lastError(c) ??
                  (c.subscription.state === "overdue" || c.subscription.state === "grace_over"
                    ? "Подписка просрочена"
                    : null);
                const kind = reason ? "danger" : c.pulse?.quiet ? "warn" : "neutral";
                return (
                  <Link
                    key={c.id}
                    to="/operator/clients/$botId"
                    params={{ botId: c.id }}
                    className="operator-queue-row"
                  >
                    <div className="operator-queue-main">
                      <strong>{c.name}</strong>
                      <span>
                        {reason ??
                          (c.pulse?.quiet
                            ? "Заказы или активность продавца снизились"
                            : `Подписка заканчивается через ${c.subscription.daysLeft ?? 0} дн.`)}
                      </span>
                    </div>
                    <Badge tone={kind}>
                      {reason ? "Сбой" : c.pulse?.quiet ? "Пульс" : "Оплата"}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
        <div className="operator-overview-aside">
          <TodayTasks />
          <section className="operator-health-summary">
            <h2>Состояние данных</h2>
            <p>
              {unread.length === 0
                ? "Данные клиентов доступны."
                : `Данные ${unread.length} клиентов прочитаны не полностью.`}
            </p>
            <Link to="/operator/health">Проверить платформу</Link>
          </section>
        </div>
      </div>
    </div>
  );
}
