import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { customerCardFn, saveCustomerNoteFn } from "@/app/admin/admin.functions";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { OrderStatus } from "./admin._authed.orders";

export const Route = createFileRoute("/admin/_authed/customers_/$key")({
  loader: ({ params }) => customerCardFn({ data: { key: params.key } }),
  component: CustomerCardPage,
});

function CustomerCardPage() {
  const { card: c, tags: known } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const router = useRouter();
  const canWrite = canEdit(shop.role);
  const [tags, setTags] = useState(c.seller.tags.join(", "));
  const [note, setNote] = useState(c.seller.note);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    await saveCustomerNoteFn({
      data: { key: c.userKey, tags: tags.split(",").map((x) => x.trim()), note },
    });
    setSaved(true);
    await router.invalidate();
  });
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(loc) : "—");
  const title = c.name || (c.username ? `@${c.username}` : `id ${c.telegramId}`);
  const row = (label: AdminKey, value: string | null | number) => (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-muted">{t(label)}</span>
      <span className="text-right">{value === null || value === "" ? "—" : value}</span>
    </div>
  );
  const spent = Object.entries(c.stats.totals)
    .map(([cur, sum]) => formatMoney(sum, cur))
    .join(" + ");

  return (
    <>
      <Link to="/admin/customers" className="text-sm text-muted hover:text-ink">
        {t("customer.back")}
      </Link>
      <PageTitle
        title={title}
        subtitle={t("customer.title")}
        actions={
          shop.modules.manager_chat && (
            <Link to="/admin/chat" search={{ c: c.telegramId }} className="btn-secondary text-xs">
              {t("customer.openChat")}
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {c.blocked && <Badge tone="danger">{t("customer.blocked")}</Badge>}
        {c.optOut && <Badge tone="warn">{t("customer.optOut")}</Badge>}
        {c.seller.tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("customer.profile")}>
          {row("customer.channel", c.platform)}
          {c.username && row("customer.channel", `@${c.username}`)}
          {row("customer.phone", c.phone)}
          {row("customer.email", c.email)}
          {row("customer.language", c.language)}
          {row("customer.country", c.country)}
          {row("customer.points", c.points)}
          {row("customer.since", date(c.createdAt))}
          {row(
            "customer.source",
            c.firstSource === "storefront" ? t("customer.sourceStorefront") : c.firstSource,
          )}
        </Card>
        <Card title={t("customer.stats")}>
          {row("customer.orders", c.stats.count)}
          {row("customer.spent", spent || "—")}
          {row("customer.firstLast", `${date(c.stats.firstAt)} — ${date(c.stats.lastAt)}`)}
        </Card>
        <Card title={t("customer.sellerTitle")}>
          <ErrorBox error={save.error} />
          <Field label={t("customer.tags")} hint={t("customer.tagsHint")}>
            <input
              className="input"
              list="customer-tags"
              value={tags}
              disabled={!canWrite}
              onChange={(e) => {
                setTags(e.target.value);
                setSaved(false);
              }}
            />
            <datalist id="customer-tags">
              {known.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
          </Field>
          <Field label={t("customer.note")}>
            <textarea
              className="input min-h-20"
              value={note}
              maxLength={2000}
              disabled={!canWrite}
              onChange={(e) => {
                setNote(e.target.value);
                setSaved(false);
              }}
            />
          </Field>
          {canWrite && (
            <div className="flex items-center justify-end gap-2">
              {saved && <span className="text-xs text-muted">{t("customer.saved")}</span>}
              <button
                className="btn-primary text-xs"
                disabled={save.busy}
                onClick={() => void save.run().catch(() => {})}
              >
                {t("customer.save")}
              </button>
            </div>
          )}
        </Card>
        <Card title={t("customer.ordersTitle")}>
          {c.orders.length === 0 ? (
            <p className="text-sm text-muted">{t("customer.noOrders")}</p>
          ) : (
            <div className="flex flex-col">
              {c.orders.map((o) => (
                <Link
                  key={o.id}
                  to="/admin/orders/$id"
                  params={{ id: String(o.id) }}
                  className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-sm last:border-b-0 hover:text-accent"
                >
                  <span>
                    #{o.no} · {date(o.createdAt)}
                  </span>
                  <span className="flex items-center gap-2">
                    {formatMoney(o.total, o.currency)}
                    <OrderStatus status={o.status} />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>
        {c.tickets.length > 0 && (
          <Card title={t("customer.ticketsTitle")}>
            {c.tickets.map((x) => (
              <Link
                key={x.id}
                to="/admin/tickets"
                className="flex justify-between gap-2 border-b border-line py-1.5 text-sm last:border-b-0 hover:text-accent"
              >
                <span className="truncate">
                  #{x.number} {x.subject}
                </span>
                <span className="shrink-0 text-muted">
                  {t(`tickets.status.${x.status}` as AdminKey)} · {date(x.createdAt)}
                </span>
              </Link>
            ))}
          </Card>
        )}
        {c.leads.length > 0 && (
          <Card title={t("customer.leadsTitle")}>
            {c.leads.map((l) => (
              <Link
                key={l.id}
                to="/admin/pipeline"
                className="flex justify-between gap-2 border-b border-line py-1.5 text-sm last:border-b-0 hover:text-accent"
              >
                <span className="truncate">{l.name}</span>
                <span className="shrink-0 text-muted">
                  {t(`pipeline.stage.${l.stage}` as AdminKey)} · {date(l.createdAt)}
                </span>
              </Link>
            ))}
          </Card>
        )}
        {c.messages.length > 0 && (
          <Card title={t("customer.chatTitle")}>
            {c.messages.map((m, i) => (
              <div key={i} className="border-b border-line py-1.5 text-sm last:border-b-0">
                <p className="text-[11px] text-muted">
                  {t(
                    `customer.from.${m.sender === "customer" ? "customer" : m.sender === "manager" ? "manager" : "bot"}`,
                  )}{" "}
                  · {new Date(m.createdAt).toLocaleString(loc)}
                </p>
                <p className="line-clamp-3 whitespace-pre-wrap">{m.text.replace(/<[^>]+>/g, "")}</p>
              </div>
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
