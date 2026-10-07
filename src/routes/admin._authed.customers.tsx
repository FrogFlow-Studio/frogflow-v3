import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { customersFn, setBlockedFn } from "@/app/admin/admin.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { CustomerSegments } from "@/app/admin/customer-segments";
import { EmptyState } from "@/app/ui/states";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/customers")({
  validateSearch: z.object({ q: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => customersFn({ data: deps }),
  component: CustomersPage,
});

function CustomersPage() {
  const rows = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [query, setQuery] = useState(q ?? "");
  const [segmentShown, setSegmentShown] = useState(false);
  const block = useAction(async (r: (typeof rows)[number], blocked: boolean) => {
    await setBlockedFn({
      data: { telegramId: r.telegram_id, blocked, username: r.username, firstName: r.first_name },
    });
    await router.invalidate();
  });
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
      {shop.role !== "accountant" && (
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
          className="input w-64"
          placeholder={t("customers.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn-secondary">{t("common.search")}</button>
      </form>
      <ErrorBox error={block.error} />
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
          <table className="table">
            <thead>
              <tr>
                <th>{t("customers.col.customer")}</th>
                <th>{t("customers.col.channel")}</th>
                <th>{t("customers.col.contacts")}</th>
                <th className="text-right">{t("customers.col.points")}</th>
                <th>{t("customers.col.since")}</th>
                {shop.modules.blocked && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_key}>
                  <td>
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
                  <td className="text-muted">
                    {[r.contact_phone, r.email].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="text-right tabular-nums">{r.loyalty_points}</td>
                  <td className="text-muted">
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
