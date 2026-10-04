import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { shopEventView } from "@/app/admin/audit-labels";
import { archiveClientFn, getClientFn, setStatusFn } from "@/app/operator/operator.functions";
import { Card, ErrorBox, PageTitle, Stat, useAction } from "@/app/ui";
import { DiagnoseCard } from "@/app/operator/client/diagnose";
import { MigrationCard, TelegramCard } from "@/app/operator/client/telegram";
import { PlanCard } from "@/app/operator/client/plan";
import { ModulesCard, AdminAccessCard, AddressingCard } from "@/app/operator/client/access";
import { ZernioCard, MetaCard } from "@/app/operator/client/channels";
import { ConsultantLimitsCard, SmartSearchLimitCard } from "@/app/operator/client/limits";
import { ShopGroupCard } from "@/app/operator/client/shop-group";
import { CommunityModCard } from "@/app/operator/client/community";
import { BillingCard } from "@/app/operator/client/billing";
import { HealthCard, MessageCard } from "@/app/operator/client/health";
import { ReceiptAuditCard } from "@/app/operator/client/receipt-audit";
import { AiBalanceCard } from "@/app/operator/client/ai-balance";
import { ConfirmName } from "@/app/operator/client/ConfirmName";
import { CLIENT_TABS, parseTab, type ClientTab } from "@/app/operator/client/confirm-name";
import { StatusBadge } from "./operator._authed.index";

export const Route = createFileRoute("/operator/_authed/clients/$botId")({
  validateSearch: (s: Record<string, unknown>): { tab?: ClientTab } =>
    s.tab === undefined ? {} : { tab: parseTab(s.tab) },
  loader: ({ params }) => getClientFn({ data: { botId: params.botId } }),
  component: ClientPage,
});

function ClientPage() {
  const {
    client: c,
    events,
    webhook,
    migration,
    consultant,
    smartSearch,
    ai,
  } = Route.useLoaderData();
  const tab = Route.useSearch().tab ?? "overview";
  const router = useRouter();
  const navigate = useNavigate();
  const refresh = () => router.invalidate();

  const status = useAction(async (s: "active" | "paused" | "suspended") => {
    await setStatusFn({ data: { botId: c.id, status: s } });
    await refresh();
  });
  const [archiving, setArchiving] = useState(false);
  const archive = useAction(async () => {
    await archiveClientFn({ data: { botId: c.id } });
    await navigate({ to: "/operator" });
  });

  return (
    <>
      <PageTitle
        title={
          <span className="flex items-center gap-2">
            {c.name} <StatusBadge status={c.status} />
          </span>
        }
        subtitle={`${c.verticalTitle} · создан ${c.createdAt ? new Date(c.createdAt).toLocaleDateString("ru") : "—"}${c.signupOrigin ? ` · пришёл: ${c.signupOrigin}` : ""}`}
        actions={
          <>
            {c.status === "active" ? (
              <button
                className="btn-secondary"
                disabled={status.busy}
                onClick={() => void status.run("paused").catch(() => {})}
              >
                ⏸ Поставить на паузу
              </button>
            ) : (
              <button
                className="btn-primary"
                disabled={status.busy}
                onClick={() => void status.run("active").catch(() => {})}
              >
                ▶ Возобновить
              </button>
            )}
            <button
              className="btn-ghost text-danger"
              disabled={archive.busy}
              onClick={() => setArchiving(true)}
            >
              Архивировать
            </button>
          </>
        }
      />
      <ErrorBox error={status.error ?? archive.error} />

      <nav
        aria-label="Разделы клиента"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-line"
      >
        {CLIENT_TABS.map((t) => (
          <Link
            key={t.key}
            to="/operator/clients/$botId"
            params={{ botId: c.id }}
            search={{ tab: t.key }}
            replace
            aria-current={tab === t.key ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-accent font-medium text-fg" : "border-transparent text-fg/70 hover:text-fg"}`}
          >
            {t.title}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Заказов за 30 дней"
              value={c.statsUnread ? "не прочитано" : (c.stats?.orders_30d ?? "—")}
              hint={
                c.statsUnread
                  ? "сбой чтения статистики — обновите страницу"
                  : c.stats?.last_order_at
                    ? `последний ${new Date(c.stats.last_order_at).toLocaleDateString("ru")}`
                    : undefined
              }
            />
            <Stat label="Заказов всего" value={c.stats?.orders_total ?? "—"} />
            <Stat label="Товаров" value={c.stats?.products_total ?? "—"} />
            <Stat
              label="Покупателей"
              value={c.stats?.customers_total?.toLocaleString("ru") ?? "—"}
              hint={
                c.stats
                  ? `${(c.stats.storage_bytes / 1024 / 1024).toFixed(0)} МБ файлов`
                  : undefined
              }
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
            <AdminAccessCard c={c} onDone={refresh} />
            <ModulesCard c={c} onDone={refresh} />
            <MetaCard c={c} onDone={refresh} />
            <MessageCard c={c} />
            <ShopGroupCard c={c} />
            <CommunityModCard c={c} />
          </div>
        </>
      )}

      {tab === "channels" && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <DiagnoseCard c={c} />
          <TelegramCard c={c} webhook={webhook} onDone={refresh} />
          <AddressingCard c={c} onDone={refresh} />
          <ZernioCard c={c} onDone={refresh} />
          <HealthCard c={c} />
        </div>
      )}

      {tab === "billing" && (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
            <PlanCard c={c} onDone={refresh} />
            <BillingCard c={c} />
            <AiBalanceCard c={c} ai={ai} onDone={refresh} />
            <ConsultantLimitsCard c={c} budget={consultant} onDone={refresh} />
            <SmartSearchLimitCard c={c} budget={smartSearch} onDone={refresh} />
          </div>
          <ReceiptAuditCard c={c} />
        </>
      )}

      {tab === "log" && (
        <Card title="Журнал">
          {events.length === 0 ? (
            <p className="text-sm text-muted">Событий пока нет.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Кто</th>
                    <th>Что</th>
                    <th>Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap text-muted">
                        {new Date(e.at).toLocaleString("ru")}
                      </td>
                      <td>{e.actor}</td>
                      <td>{shopEventView(e)?.title ?? e.kind}</td>
                      <td className="max-w-md truncate font-mono text-xs text-muted">
                        {shopEventView(e)?.details ?? JSON.stringify(e.payload)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "migration" && <MigrationCard c={c} migration={migration} onDone={refresh} />}

      {archiving && (
        <ConfirmName
          name={c.name}
          title="Архивировать клиента?"
          text="Бот перестанет отвечать, данные останутся."
          confirmLabel="Архивировать"
          onConfirm={() => archive.run()}
          onCancel={() => setArchiving(false)}
        />
      )}
    </>
  );
}
