import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { listClientsFn } from "@/app/operator/operator.functions";
import type { Pulse } from "@/app/operator/pulse";
import {
  channelStates,
  isPaymentSoon,
  isProblem,
  lastError,
  planLabel,
} from "@/app/operator/client-health";
import { TodayTasks } from "@/app/operator/client/notes";
import { Badge, Empty, PageTitle, Stat } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/")({
  loader: () => listClientsFn(),
  component: ClientsPage,
});

function ClientsPage() {
  const clients = Route.useLoaderData();
  const [q, setQ] = useState("");
  const [served, setServed] = useState<"" | "v1" | "v2">("");
  const [status, setStatus] = useState("");
  const [quietOnly, setQuietOnly] = useState(false);
  const [byRisk, setByRisk] = useState(true);
  const [problemOnly, setProblemOnly] = useState(false);
  const [soonOnly, setSoonOnly] = useState(false);
  const shown = clients.filter(
    (c) =>
      (!q || c.name.toLowerCase().includes(q.toLowerCase()) || c.slug?.includes(q.toLowerCase())) &&
      (!served || (served === "v2" ? c.servedBy === "v2" : c.servedBy !== "v2")) &&
      (!status || c.status === status) &&
      (!quietOnly || c.pulse?.quiet) &&
      (!problemOnly || isProblem(c)) &&
      (!soonOnly || isPaymentSoon(c)),
  );
  // Сервер отдаёт список по риску; без галочки — прежний порядок: по заказам за 30 дней.
  if (!byRisk)
    shown.sort(
      (a, b) =>
        (b.stats?.orders_30d ?? 0) - (a.stats?.orders_30d ?? 0) ||
        a.name.localeCompare(b.name, "ru"),
    );
  const v2Clients = clients.filter((c) => c.servedBy === "v2");
  const pulseMissing = v2Clients.length > 0 && v2Clients.every((c) => !c.pulse);
  const statsUnread = clients.some((c) => c.statsUnread);
  const orders30 = clients.reduce((s, c) => s + (c.stats?.orders_30d ?? 0), 0);
  const customers = clients.reduce((s, c) => s + (c.stats?.customers_total ?? 0), 0);
  return (
    <>
      <PageTitle
        title="Клиенты"
        subtitle={`${clients.length} магазинов на платформе`}
        actions={
          <Link to="/operator/clients/new" className="btn-primary">
            + Подключить клиента
          </Link>
        }
      />
      <TodayTasks />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Клиентов"
          value={clients.length}
          hint={`${clients.filter((c) => c.status === "active").length} активных`}
        />
        <Stat label="Заказов за 30 дней" value={statsUnread ? "не прочитано" : orders30} />
        <Stat
          label="Покупателей"
          value={statsUnread ? "не прочитано" : customers.toLocaleString("ru")}
        />
        <Stat
          label="На v2"
          value={clients.filter((c) => c.servedBy === "v2").length}
          hint="обслуживаются этим деплоем"
        />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className="input max-w-sm"
          placeholder="Поиск по названию или адресу"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input w-44"
          value={served}
          onChange={(e) => setServed(e.target.value as "" | "v1" | "v2")}
        >
          <option value="">Все платформы</option>
          <option value="v2">На v2</option>
          <option value="v1">Ещё на v1</option>
        </select>
        <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Любой статус</option>
          <option value="active">активен</option>
          <option value="paused">пауза</option>
          <option value="suspended">приостановлен</option>
        </select>
        <label className="flex items-center gap-1 self-center text-sm">
          <input
            type="checkbox"
            checked={quietOnly}
            onChange={(e) => setQuietOnly(e.target.checked)}
          />
          Затихли ({clients.filter((c) => c.pulse?.quiet).length})
          {pulseMissing && <span className="text-warn"> · пульс не прочитан</span>}
        </label>
        <label className="flex items-center gap-1 self-center text-sm">
          <input
            type="checkbox"
            checked={problemOnly}
            onChange={(e) => setProblemOnly(e.target.checked)}
          />
          Проблемные ({clients.filter(isProblem).length})
        </label>
        <label className="flex items-center gap-1 self-center text-sm">
          <input
            type="checkbox"
            checked={soonOnly}
            onChange={(e) => setSoonOnly(e.target.checked)}
          />
          Оплата скоро ({clients.filter(isPaymentSoon).length})
        </label>
        <label className="flex items-center gap-1 self-center text-sm">
          <input type="checkbox" checked={byRisk} onChange={(e) => setByRisk(e.target.checked)} />
          По риску
        </label>
        <span className="self-center text-sm text-muted">Показано: {shown.length}</span>
      </div>
      {shown.length === 0 ? (
        <Empty>Ничего не найдено.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Статус</th>
                <th>Тариф и срок</th>
                <th>Каналы</th>
                <th className="text-right">Заказов / 7 дн</th>
                <th className="text-right">Долг</th>
                <th>Последняя ошибка</th>
                <th>Пульс</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const err = lastError(c);
                return (
                  <tr key={c.id} className="hover:bg-surface-2/60">
                    <td>
                      <Link
                        to="/operator/clients/$botId"
                        params={{ botId: c.id }}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted">
                        {c.verticalTitle} ·{" "}
                        {c.slug ? `/s/${c.slug}` : (c.appUrl?.replace(/^https?:\/\//, "") ?? "—")}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>
                      <div className="mb-1 text-xs text-muted">{planLabel(c.plan)}</div>
                      <SubscriptionBadge s={c.subscription} expiresAt={c.subscriptionExpiresAt} />
                    </td>
                    <td className="space-x-1">
                      {channelStates(c).map((ch) => (
                        <span key={ch.key} title={ch.hint || undefined}>
                          <Badge tone={ch.tone}>{ch.label}</Badge>
                        </span>
                      ))}
                    </td>
                    <td className="text-right tabular-nums">{c.pulse ? c.pulse.last7 : "—"}</td>
                    <td className="text-right tabular-nums">
                      {c.debtUnread ? (
                        <span className="text-warn">не прочитано</span>
                      ) : c.debt ? (
                        <span className="text-danger">
                          {c.debt.amount.toLocaleString("ru")} ₸
                          <span className="block text-xs text-muted">счетов: {c.debt.count}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-xs">
                      {err ? (
                        <span className="text-danger">{err}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <PulseCell p={c.pulse} v2={c.servedBy === "v2"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PulseCell({ p, v2 }: { p: Pulse | null; v2: boolean }) {
  if (!p)
    return v2 ? (
      <span className="text-warn">пульс не прочитан</span>
    ) : (
      <span className="text-muted">—</span>
    );
  const arrow = p.changePct === null ? "" : p.changePct > 0 ? "↑" : p.changePct < 0 ? "↓" : "→";
  const login =
    p.daysSinceLogin === null
      ? "не заходил 90+ дн"
      : p.daysSinceLogin === 0
        ? "вход сегодня"
        : `вход ${p.daysSinceLogin} дн назад`;
  return (
    <div className="text-xs">
      <div className="tabular-nums">
        {p.recent} vs {p.previous} опл. {arrow}
        {p.changePct !== null && ` ${p.changePct > 0 ? "+" : ""}${p.changePct}%`}{" "}
        {p.quiet && <Badge tone="warn">затих</Badge>}
      </div>
      <div className={p.noLogin ? "text-warn" : "text-muted"}>{login}</div>
      <div className="text-muted">
        {!p.orderKnown
          ? "—"
          : p.daysSinceOrder === null
            ? "заказов не было"
            : `без заказов ${p.daysSinceOrder} дн`}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge tone="ok">активен</Badge>;
  if (status === "paused") return <Badge tone="warn">пауза</Badge>;
  return <Badge tone="danger">приостановлен</Badge>;
}

export function SubscriptionBadge({
  s,
  expiresAt,
}: {
  s: { state: string; daysLeft: number | null };
  expiresAt: string | null;
}) {
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString("ru") : "";
  if (s.state === "no_data") return <Badge>не заведена</Badge>;
  if (s.state === "ok") return <Badge tone="ok">до {until}</Badge>;
  if (s.state === "expiring") return <Badge tone="warn">истекает через {s.daysLeft} дн.</Badge>;
  if (s.state === "overdue") return <Badge tone="warn">просрочена {-(s.daysLeft ?? 0)} дн.</Badge>;
  return <Badge tone="danger">просрочена {-(s.daysLeft ?? 0)} дн.</Badge>;
}

export function HealthBadge({
  h,
}: {
  h: { ok: boolean; at: string; error: string | null; pending: number | null } | null;
}) {
  if (!h) return <Badge>нет данных</Badge>;
  const when = new Date(h.at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  if (h.ok)
    return (
      <Badge tone="ok">
        работает{h.pending ? ` · очередь ${h.pending}` : ""} · {when}
      </Badge>
    );
  return (
    <Badge tone="danger">
      {h.error ? h.error.slice(0, 40) : "сбой"} · {when}
    </Badge>
  );
}
