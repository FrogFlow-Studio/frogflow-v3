import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { shopEventView } from "@/app/admin/audit-labels";
import { archiveClientFn, getClientFn, setStatusFn } from "@/app/operator/operator.functions";
import { Card, ErrorBox, PageTitle, Stat, useAction } from "@/app/ui";
import { TelegramCard } from "@/app/operator/client/telegram";
import { PlanCard } from "@/app/operator/client/plan";
import { ModulesCard, AdminAccessCard, AddressingCard } from "@/app/operator/client/access";
import { ZernioCard, MetaCard } from "@/app/operator/client/channels";
import { ConsultantLimitsCard, SmartSearchLimitCard } from "@/app/operator/client/limits";
import { ShopGroupCard } from "@/app/operator/client/shop-group";
import { BillingCard } from "@/app/operator/client/billing";
import { HealthCard, MessageCard } from "@/app/operator/client/health";
import { ReceiptAuditCard } from "@/app/operator/client/receipt-audit";
import { AiBalanceCard } from "@/app/operator/client/ai-balance";
import { StatusBadge } from "./operator._authed.index";

export const Route = createFileRoute("/operator/_authed/clients/$botId")({
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
  const router = useRouter();
  const navigate = useNavigate();
  const refresh = () => router.invalidate();

  const status = useAction(async (s: "active" | "paused" | "suspended") => {
    await setStatusFn({ data: { botId: c.id, status: s } });
    await refresh();
  });
  const archive = useAction(async () => {
    if (!confirm(`Архивировать «${c.name}»? Бот перестанет отвечать, данные останутся.`)) return;
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
              onClick={() => void archive.run().catch(() => {})}
            >
              Архивировать
            </button>
          </>
        }
      />
      <ErrorBox error={status.error ?? archive.error} />

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
            c.stats ? `${(c.stats.storage_bytes / 1024 / 1024).toFixed(0)} МБ файлов` : undefined
          }
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <TelegramCard c={c} webhook={webhook} migration={migration} onDone={refresh} />
        <AdminAccessCard c={c} onDone={refresh} />
        <div className="space-y-4">
          <PlanCard c={c} onDone={refresh} />
          <ModulesCard c={c} onDone={refresh} />
        </div>
        <div className="space-y-4">
          <AddressingCard c={c} onDone={refresh} />
          <ZernioCard c={c} onDone={refresh} />
          <MetaCard c={c} onDone={refresh} />
          <AiBalanceCard c={c} ai={ai} onDone={refresh} />
          <ConsultantLimitsCard c={c} budget={consultant} onDone={refresh} />
          <SmartSearchLimitCard c={c} budget={smartSearch} onDone={refresh} />
          <ShopGroupCard c={c} />
          <MessageCard c={c} />
          <BillingCard c={c} />
          <HealthCard c={c} />
        </div>
      </div>

      <ReceiptAuditCard c={c} />

      <Card title="Журнал" className="mt-4">
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
    </>
  );
}
