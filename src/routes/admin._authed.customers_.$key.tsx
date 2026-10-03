import { canEdit } from "@/core/auth/roles";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  customerCardFn,
  customersFn,
  linkCustomerFn,
  saveCustomerBirthdayFn,
  saveCustomerNoteFn,
  unlinkCustomerFn,
} from "@/app/admin/admin.functions";
import { adjustPointsFn } from "@/app/admin/loyalty.functions";
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
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [adjusted, setAdjusted] = useState<string | null>(null);
  const adjust = useAction(async () => {
    setAdjusted(null);
    const r = await adjustPointsFn({
      data: { key: c.userKey, delta: sign * Number(amount), reason: reason.trim() },
    });
    setAdjusted(t("customer.adjust.done", { before: r.before, after: r.after }));
    setAmount("");
    setReason("");
    await router.invalidate();
  });
  const amountOk = /^\d+$/.test(amount) && Number(amount) > 0 && Number(amount) <= 1_000_000;
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
          <BirthdayRow />
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
        {shop.modules.loyalty && canWrite && (
          <Card title={t("customer.adjust.title")}>
            <ErrorBox error={adjust.error} />
            <div className="mb-2 flex gap-2">
              <select
                className="input w-auto"
                value={sign}
                onChange={(e) => setSign(e.target.value === "-1" ? -1 : 1)}
              >
                <option value={1}>{t("customer.adjust.add")}</option>
                <option value={-1}>{t("customer.adjust.sub")}</option>
              </select>
              <input
                className="input"
                inputMode="numeric"
                placeholder={t("customer.adjust.amount")}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value.trim());
                  setAdjusted(null);
                }}
              />
            </div>
            <Field label={t("customer.adjust.reason")}>
              <input
                className="input"
                maxLength={120}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setAdjusted(null);
                }}
              />
            </Field>
            <div className="flex items-center justify-end gap-2">
              {adjusted && <span className="text-xs text-muted">{adjusted}</span>}
              <button
                className="btn-primary text-xs"
                disabled={adjust.busy || !amountOk || reason.trim().length < 3}
                onClick={() => void adjust.run().catch(() => {})}
              >
                {t("customer.adjust.apply")}
              </button>
            </div>
          </Card>
        )}
        <LinkedCard />
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
                    {c.linked.length > 0 && <span className="text-muted"> · {o.platform}</span>}
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

/** Профили этого покупателя в других каналах и ручная связь (core/customers/identity). */
function LinkedCard() {
  const { card: c } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const canWrite = canEdit(shop.role);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Awaited<ReturnType<typeof customersFn>> | null>(null);
  const search = useAction(async () => {
    const rows = await customersFn({ data: { q } });
    const linked = new Set(c.linked.map((l) => l.userKey));
    setFound(rows.filter((r) => r.user_key !== c.userKey && !linked.has(r.user_key)).slice(0, 8));
  });
  const link = useAction(async (other: string, on: boolean) => {
    const data = { key: c.userKey, other };
    await (on ? linkCustomerFn({ data }) : unlinkCustomerFn({ data }));
    setFound(null);
    setQ("");
    await router.invalidate();
  });
  if (c.linked.length === 0 && !canWrite) return null;
  return (
    <Card title={t("customer.linkedTitle")}>
      <ErrorBox error={search.error ?? link.error} />
      {c.linked.length > 0 && (
        <>
          <p className="mb-2 text-xs text-muted">{t("customer.linkedHint")}</p>
          {c.linked.map((l) => (
            <div
              key={l.userKey}
              className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-sm last:border-b-0"
            >
              <Link
                to="/admin/customers/$key"
                params={{ key: l.userKey }}
                className="truncate hover:text-accent"
              >
                {l.platform} · {l.name || (l.username ? `@${l.username}` : l.userKey)}
              </Link>
              <span className="flex shrink-0 items-center gap-1">
                {l.reasons.map((r) => (
                  <Badge key={r}>{t(`customer.reason.${r}`)}</Badge>
                ))}
                {canWrite && l.reasons.includes("manual") && (
                  <button
                    className="btn-ghost text-xs"
                    disabled={link.busy}
                    onClick={() => void link.run(l.userKey, false).catch(() => {})}
                  >
                    {t("customer.unlink")}
                  </button>
                )}
              </span>
            </div>
          ))}
        </>
      )}
      {canWrite && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) void search.run().catch(() => {});
          }}
        >
          <input
            className="input"
            placeholder={t("customer.linkSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-secondary text-xs" disabled={search.busy}>
            {t("customer.find")}
          </button>
        </form>
      )}
      {found && (
        <div className="mt-2">
          {found.length === 0 && <p className="text-sm text-muted">{t("customer.linkNone")}</p>}
          {found.map((r) => (
            <div key={r.user_key} className="flex items-center justify-between gap-2 py-1 text-sm">
              <span className="truncate">
                {r.platform} ·{" "}
                {[r.first_name, r.last_name].filter(Boolean).join(" ") ||
                  (r.username ? `@${r.username}` : r.user_key)}
                {r.contact_phone && <span className="text-muted"> · {r.contact_phone}</span>}
              </span>
              <button
                className="btn-secondary text-xs"
                disabled={link.busy}
                onClick={() => void link.run(r.user_key, true).catch(() => {})}
              >
                {t("customer.link")}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** День рождения в карточке: видно всем ролям, править — менеджер и выше. */
function BirthdayRow() {
  const { card: c } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const shown = c.birthday ? `${c.birthday.slice(3)}.${c.birthday.slice(0, 2)}` : "";
  const [value, setValue] = useState(shown);
  const save = useAction(async () => {
    await saveCustomerBirthdayFn({ data: { key: c.userKey, birthday: value } });
    await router.invalidate();
  });
  if (!canEdit(shop.role))
    return (
      <div className="flex justify-between gap-3 py-1 text-sm">
        <span className="text-muted">{t("birthday.customer")}</span>
        <span>{shown || "—"}</span>
      </div>
    );
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-muted">{t("birthday.customer")}</span>
      <span className="flex items-center gap-2">
        <input
          className="input h-8 w-24 text-right"
          placeholder={t("birthday.customerHint")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {value !== shown && (
          <button
            className="btn-secondary text-xs"
            disabled={save.busy}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("common.save")}
          </button>
        )}
      </span>
      <ErrorBox error={save.error} />
    </div>
  );
}
