import { HelpTip } from "@/app/admin/help-panel";
import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { blockedListFn, customersFn, setBlockedFn } from "@/app/admin/customers.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { CustomerSegments } from "@/app/admin/customer-segments";
import { EmptyState } from "@/app/ui/states";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/customers")({
  validateSearch: z.object({ q: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [rows, blocked] = await Promise.all([customersFn({ data: deps }), blockedListFn()]);
    return { rows, blocked };
  },
  component: CustomersPage,
});

function CustomersPage() {
  const { rows, blocked } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [query, setQuery] = useState(q ?? "");
  const [segmentShown, setSegmentShown] = useState(false);
  // Консультант без продаж (BOVI): баллов и сегментов по покупкам у него нет.
  const sells = shop.sells !== false;
  const block = useAction(
    async (
      r: { telegram_id: number; username: string | null; first_name: string | null },
      blocked: boolean,
    ) => {
      await setBlockedFn({
        data: { telegramId: r.telegram_id, blocked, username: r.username, firstName: r.first_name },
      });
      await router.invalidate();
    },
  );
  // Кого нет в списке выше (блок из v1 у человека без записи покупателя, или он не попал в 200 новых).
  const shownIds = new Set(rows.map((r) => r.telegram_id));
  const blockedHidden = blocked.filter((b) => !shownIds.has(b.telegram_id));
  return (
    <>
      <PageTitle
        title={t("customers.title")}
        subtitle={t("customers.shown", { n: rows.length })}
        actions={
          // Контакты выгружают только владелец и менеджер (сервер проверяет то же).
          shop.modules.excel_export &&
          canEdit(shop.role) && (
            <a className="btn-secondary text-xs" href="/api/admin/export/customers">
              {t("common.exportExcel")}
            </a>
          )
        }
      />
      {sells && shop.role !== "accountant" && (
        <CustomerSegments
          t={t}
          locale={shop.locale}
          canWrite={canEdit(shop.role)}
          onActive={setSegmentShown}
        />
      )}
      <form
        className="mb-4 flex gap-2"
        hidden={segmentShown}
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ to: "/admin/customers", search: { q: query || undefined } });
        }}
      >
        <input
          className="input min-w-0 flex-1 md:w-64 md:flex-none"
          placeholder={t("customers.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn-secondary">{t("common.search")}</button>
      </form>
      <ErrorBox error={block.error} />
      {shop.modules.blocked && !segmentShown && !q && blockedHidden.length > 0 && (
        <div className="card mb-4">
          <h3 className="mb-1 font-medium">
            {t("customers.blockedList", { n: blockedHidden.length })}
          </h3>
          <p className="mb-2 text-xs text-muted">{t("customers.blockedListHint")}</p>
          <ul className="space-y-1">
            {blockedHidden.map((b) => (
              <li key={b.telegram_id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {b.first_name || "—"}{" "}
                  {b.username && <span className="text-muted">@{b.username}</span>}{" "}
                  <span className="text-muted">ID {b.telegram_id}</span>
                </span>
                <button
                  className="btn-ghost text-xs"
                  disabled={block.busy}
                  onClick={() => void block.run(b, false).catch(() => {})}
                >
                  {t("customers.unblock")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {segmentShown ? null : rows.length === 0 ? (
        q ? (
          <Empty>{t("customers.empty")}</Empty>
        ) : (
          <EmptyState
            title={t("customers.emptyTitle")}
            // Консультант без продаж: покупатели приходят из переписки, товаров у него нет.
            hint={t(shop.sells === false ? "customers.emptyHintChat" : "customers.emptyHint")}
            action={
              shop.sells === false
                ? undefined
                : { label: t("states.addProducts"), to: "/admin/products" }
            }
          />
        )
      ) : (
        <div className="card overflow-x-auto">
          <table className="table table-cards">
            <thead>
              <tr>
                <th>{t("customers.col.customer")}</th>
                <th>{t("customers.col.channel")}</th>
                <th>{t("customers.col.contacts")}</th>
                {sells && <th className="text-right">{t("customers.col.points")}</th>}
                <th>{t("customers.col.since")}</th>
                {shop.modules.blocked && (
                  <th className="text-right">
                    <HelpTip article="customers" anchor="block" />
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_key}>
                  <td className="cell-main">
                    <Link
                      to="/admin/customers/$key"
                      params={{ key: r.user_key }}
                      className="hover:text-accent"
                    >
                      {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                    </Link>{" "}
                    {r.username && <span className="text-muted">@{r.username}</span>}
                    {r.blocked && <Badge tone="danger">{t("customers.blocked")}</Badge>}
                  </td>
                  <td className="text-muted">{r.platform}</td>
                  <td
                    className={`cell-break break-words text-muted ${r.contact_phone || r.email ? "" : "cell-phone-hide"}`}
                  >
                    {[r.contact_phone, r.email].filter(Boolean).join(" · ") || "—"}
                  </td>
                  {sells && (
                    <td className="text-right tabular-nums" data-label={t("customers.col.points")}>
                      {r.loyalty_points}
                    </td>
                  )}
                  <td className="text-muted" data-label={t("customers.col.since")}>
                    {new Date(r.created_at).toLocaleDateString(intlLocale(shop.locale))}
                  </td>
                  {shop.modules.blocked && (
                    <td className="text-right">
                      <button
                        className={`btn-ghost text-xs ${r.blocked ? "" : "text-danger"}`}
                        disabled={block.busy || r.platform !== "telegram"}
                        onClick={() => void block.run(r, !r.blocked).catch(() => {})}
                      >
                        {r.blocked ? t("customers.unblock") : t("customers.block")}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
