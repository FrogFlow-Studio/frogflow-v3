import { createFileRoute, Link } from "@tanstack/react-router";
import { listClientsFn } from "@/app/operator/clients.functions";
import {
  channelStates,
  isPaymentSoon,
  isProblem,
  lastError,
  planLabel,
} from "@/app/operator/client-health";
import { StatusBadge, SubscriptionBadge } from "@/app/operator/client-badges";
import { Badge, Empty, PageTitle } from "@/app/ui";

const VIEWS = ["all", "problem", "quiet", "payment"] as const;
type View = (typeof VIEWS)[number];
export const Route = createFileRoute("/operator/_authed/clients/")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { q?: string; view?: View; status?: string; served?: string } => ({
    q: typeof s.q === "string" ? s.q : undefined,
    view: VIEWS.find((v) => v === s.view),
    status: ["active", "paused", "suspended"].includes(String(s.status))
      ? String(s.status)
      : undefined,
    served: ["v1", "v2"].includes(String(s.served)) ? String(s.served) : undefined,
  }),
  loader: () => listClientsFn(),
  component: ClientDirectory,
});

function ClientDirectory() {
  const clients = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = search.view ?? "all";
  const q = (search.q ?? "").trim().toLocaleLowerCase("ru");
  const matchView = (c: (typeof clients)[number], selected: View) =>
    selected === "all" ||
    (selected === "problem" && isProblem(c)) ||
    (selected === "quiet" && Boolean(c.pulse?.quiet)) ||
    (selected === "payment" && isPaymentSoon(c));
  const shown = clients.filter(
    (c) =>
      matchView(c, view) &&
      (!q || [c.name, c.slug, c.appUrl].some((v) => v?.toLocaleLowerCase("ru").includes(q))) &&
      (!search.status || c.status === search.status) &&
      (!search.served || (search.served === "v2" ? c.servedBy === "v2" : c.servedBy !== "v2")),
  );
  return (
    <div className="operator-directory">
      <PageTitle
        title="Клиенты"
        subtitle="Состояние магазинов, отношения с владельцами и ближайшие действия."
        actions={
          <Link to="/operator/clients/new" className="btn-primary">
            Подключить клиента
          </Link>
        }
      />
      <nav className="operator-directory-views" aria-label="Состояние клиентов">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() =>
              void navigate({ search: (prev) => ({ ...prev, view: v }), replace: true })
            }
          >
            {
              {
                all: "Все клиенты",
                problem: "Нужна помощь",
                quiet: "Активность снизилась",
                payment: "Оплата скоро",
              }[v]
            }
            <span>{clients.filter((c) => matchView(c, v)).length}</span>
          </button>
        ))}
      </nav>
      <div className="operator-directory-tools">
        <input
          className="input"
          type="search"
          aria-label="Найти клиента"
          placeholder="Название, адрес магазина…"
          value={search.q ?? ""}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({ ...prev, q: e.target.value || undefined }),
              replace: true,
            })
          }
        />
        <select
          className="input"
          aria-label="Статус клиента"
          value={search.status ?? ""}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({ ...prev, status: e.target.value || undefined }),
              replace: true,
            })
          }
        >
          <option value="">Любой статус</option>
          <option value="active">Активные</option>
          <option value="paused">На паузе</option>
          <option value="suspended">Приостановленные</option>
        </select>
        <select
          className="input"
          aria-label="Платформа клиента"
          value={search.served ?? ""}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({ ...prev, served: e.target.value || undefined }),
              replace: true,
            })
          }
        >
          <option value="">Все платформы</option>
          <option value="v2">Текущая платформа</option>
          <option value="v1">Прежняя платформа</option>
        </select>
        <span>
          {shown.length} из {clients.length}
        </span>
      </div>
      {!shown.length ? (
        <Empty>По этим условиям клиентов нет. Измените поиск или фильтры.</Empty>
      ) : (
        <div className="operator-client-directory">
          <div className="operator-client-columnhead">
            <span>Магазин</span>
            <span>Сигнал</span>
            <span>Каналы</span>
            <span>Подписка</span>
          </div>
          {shown.map((c) => {
            const error = lastError(c);
            const incomplete = c.statsUnread || c.debtUnread || (c.servedBy === "v2" && !c.pulse);
            const reason =
              error ??
              (c.subscription.state === "overdue" || c.subscription.state === "grace_over"
                ? "Подписка просрочена"
                : c.pulse?.quiet
                  ? "Заказы или активность снизились"
                  : incomplete
                    ? "Данные прочитаны не полностью"
                    : "Нет известных проблем");
            return (
              <article key={c.id} className="operator-client-record">
                <div className="operator-client-record-main">
                  <div>
                    <Link
                      to="/operator/clients/$botId"
                      params={{ botId: c.id }}
                      className="operator-client-name"
                    >
                      {c.name}
                    </Link>
                    <p>{c.verticalTitle}</p>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="operator-client-reason">
                    <Badge
                      tone={
                        error
                          ? "danger"
                          : isProblem(c) || c.pulse?.quiet || incomplete
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {reason}
                    </Badge>
                    <small>
                      {c.pulse
                        ? `${c.pulse.last7} оплаченных заказов за 7 дней`
                        : "Пульс недоступен"}
                    </small>
                  </div>
                  <div className="operator-client-channels">
                    {channelStates(c).map((ch) => (
                      <span key={ch.key}>
                        <Badge tone={ch.tone}>{ch.label}</Badge>
                        {ch.hint && <small>{ch.hint}</small>}
                      </span>
                    ))}
                  </div>
                  <div>
                    <p>{planLabel(c.plan)}</p>
                    <SubscriptionBadge s={c.subscription} expiresAt={c.subscriptionExpiresAt} />
                  </div>
                </div>
                <details className="operator-client-detail">
                  <summary>Показатели и задолженность</summary>
                  <div>
                    <span>
                      Заказов за 30 дней{" "}
                      <b>{c.statsUnread ? "нет данных" : (c.stats?.orders_30d ?? "—")}</b>
                    </span>
                    <span>
                      Долг{" "}
                      <b>
                        {c.debtUnread
                          ? "нет данных"
                          : c.debt
                            ? `${c.debt.amount.toLocaleString("ru")} ₸`
                            : "нет"}
                      </b>
                    </span>
                    <span>
                      Адрес <b>{c.slug ? `/s/${c.slug}` : (c.appUrl ?? "не задан")}</b>
                    </span>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
