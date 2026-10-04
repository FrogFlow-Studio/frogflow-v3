import { createFileRoute, useRouteContext, useRouter } from "@tanstack/react-router";
import { ProductPicker, type PickerProduct } from "@/app/admin/product-picker";
import { useEffect, useState } from "react";
import { offerQueueFn } from "@/app/admin/stock-reports.functions";
import { loyaltyTiersFn, saveLoyaltyTiersFn } from "@/app/admin/loyalty.functions";
import {
  announceOfferFn,
  deleteOfferFn,
  endOfferFn,
  offersFn,
  saveOfferFn,
} from "@/app/admin/offers.functions";
import {
  cancelGiftCertificateFn,
  createGiftCertificateFn,
  deletePromoCodeFn,
  giftCertificatesFn,
  giftSaleFn,
  promoCodesFn,
  saveGiftSaleFn,
  savePromoCodeFn,
  saveSettingsFn,
  settingsFn,
} from "@/app/admin/admin.functions";
import { AskCommunityAdvice } from "@/app/admin/community-ask";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { utcToZonedLocal } from "@/core/export/csv";
import { referralReportFn } from "@/app/admin/loyalty.functions";

export const Route = createFileRoute("/admin/_authed/discounts")({
  // Из отчёта «Залежавшийся товар»: id товаров через запятую — очередь для акций.
  validateSearch: (s: Record<string, unknown>): { offerProducts?: string } => ({
    offerProducts: typeof s.offerProducts === "string" ? s.offerProducts.slice(0, 800) : undefined,
  }),
  loader: async () => {
    const [promos, gifts, settings, giftSale, tiers] = await Promise.all([
      promoCodesFn(),
      giftCertificatesFn(),
      settingsFn(),
      giftSaleFn(),
      loyaltyTiersFn().catch(() => null),
    ]);
    return {
      tiers,
      promos,
      gifts,
      giftSale,
      referralPercent: settings.settings.referral_discount_percent ?? "",
    };
  },
  component: DiscountsPage,
});

type Promo = Awaited<ReturnType<typeof promoCodesFn>>[number];

function DiscountsPage() {
  const { promos, gifts, giftSale, referralPercent, tiers } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  return (
    <>
      <PageTitle title={t("discounts.title")} subtitle={t("discounts.subtitle")} />
      <AskCommunityAdvice page="discounts" t={t} />
      <div className="grid gap-4 lg:grid-cols-2">
        {shop.modules.coupons && <PromoCard promos={promos} />}
        {shop.modules.gift_certificates && (
          <GiftCard gifts={gifts} currency={promos[0] ? "KZT" : "KZT"} />
        )}
        {shop.modules.gift_certificates && <GiftSaleCard sale={giftSale} />}
        {shop.modules.referral && <ReferralCard percent={referralPercent} bot={shop.telegram} />}
        {shop.modules.referral && <ReferralReportCard />}

        {shop.modules.loyalty && tiers && <TiersCard tiers={tiers} />}
        {shop.modules.limited_offers && <OffersCard />}
      </div>
    </>
  );
}

function PromoCard({ promos }: { promos: Promo[] }) {
  const router = useRouter();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [editing, setEditing] = useState<Promo | "new" | null>(null);
  const save = useAction(async (f: FormData, id: string | null) => {
    const mu = String(f.get("maxUses")).trim();
    const vu = String(f.get("validUntil")).trim();
    await savePromoCodeFn({
      data: {
        id,
        code: String(f.get("code")),
        discountType: String(f.get("discountType")) as "percent" | "fixed",
        discountValue: Number(f.get("discountValue")),
        maxUses: mu ? Number(mu) : null,
        validUntil: vu || null,
        isActive: f.get("isActive") === "on",
        oncePerBuyer: f.get("oncePerBuyer") === "on",
      },
    });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm(t("discounts.promo.deleteConfirm"))) return;
    await deletePromoCodeFn({ data: { id } });
    await router.invalidate();
  });
  const cur = editing === "new" ? null : editing;
  return (
    <Card
      title={t("discounts.promo.title")}
      actions={
        <button className="btn-secondary text-xs" onClick={() => setEditing("new")}>
          {t("discounts.promo.new")}
        </button>
      }
    >
      {promos.length === 0 ? (
        <Empty>{t("discounts.promo.empty")}</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("discounts.col.code")}</th>
              <th>{t("discounts.col.discount")}</th>
              <th>{t("discounts.col.uses")}</th>
              <th>{t("discounts.col.validUntil")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {promos.map((p) => {
              const expired = p.valid_until && new Date(p.valid_until) < new Date();
              const exhausted = p.max_uses !== null && p.used_count >= p.max_uses;
              return (
                <tr key={p.id}>
                  <td className="font-mono font-medium">
                    {p.code} {!p.is_active && <Badge>{t("discounts.promo.off")}</Badge>}
                    {expired && <Badge tone="warn">{t("discounts.promo.expired")}</Badge>}
                    {exhausted && <Badge tone="warn">{t("discounts.promo.exhausted")}</Badge>}
                    {p.once_per_buyer && <Badge>{t("discounts.promo.onceBadge")}</Badge>}
                  </td>
                  <td>
                    {p.discount_type === "percent"
                      ? `${Number(p.discount_value)} %`
                      : `${Number(p.discount_value)} ₸`}
                  </td>
                  <td className="tabular-nums">
                    {p.used_count}
                    {p.max_uses !== null ? ` / ${p.max_uses}` : ""}
                  </td>
                  <td className="text-muted">
                    {p.valid_until
                      ? new Date(p.valid_until).toLocaleDateString(intlLocale(shop.locale))
                      : t("discounts.promo.noExpiry")}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => setEditing(p)}>
                      {t("common.edit")}
                    </button>
                    <button
                      className="btn-ghost text-xs text-danger"
                      onClick={() => void del.run(p.id).catch(() => {})}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ErrorBox error={del.error} />
      {editing !== null && (
        <form
          key={cur?.id ?? "new"}
          className="mt-4 space-y-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(new FormData(e.currentTarget), cur?.id ?? null).catch(() => {});
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("discounts.col.code")}>
              <input
                className="input font-mono uppercase"
                name="code"
                defaultValue={cur?.code ?? ""}
                required
                minLength={2}
                maxLength={40}
                placeholder="SALE10"
              />
            </Field>
            <Field label={t("discounts.promo.type")}>
              <select
                className="input"
                name="discountType"
                defaultValue={cur?.discount_type ?? "percent"}
              >
                <option value="percent">{t("discounts.promo.typePercent")}</option>
                <option value="fixed">{t("discounts.promo.typeFixed")}</option>
              </select>
            </Field>
            <Field label={t("discounts.promo.value")}>
              <input
                className="input"
                name="discountValue"
                type="number"
                min={0.01}
                step="0.01"
                defaultValue={cur ? Number(cur.discount_value) : ""}
                required
              />
            </Field>
            <Field label={t("discounts.promo.maxUses")} hint={t("discounts.promo.maxUsesHint")}>
              <input
                className="input"
                name="maxUses"
                type="number"
                min={1}
                defaultValue={cur?.max_uses ?? ""}
              />
            </Field>
            <Field label={t("discounts.col.validUntil")}>
              <input
                className="input"
                name="validUntil"
                type="date"
                defaultValue={cur?.valid_until ? cur.valid_until.slice(0, 10) : ""}
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={cur?.is_active ?? true} />{" "}
              {t("discounts.promo.active")}
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                name="oncePerBuyer"
                defaultChecked={cur?.once_per_buyer ?? false}
              />{" "}
              {t("discounts.promo.oncePerBuyer")}
            </label>
          </div>
          <ErrorBox error={save.error} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

type Gift = Awaited<ReturnType<typeof giftCertificatesFn>>[number];

function GiftCard({ gifts, currency }: { gifts: Gift[]; currency: string }) {
  const router = useRouter();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [created, setCreated] = useState<string | null>(null);
  const create = useAction(async (f: FormData) => {
    const r = await createGiftCertificateFn({
      data: {
        amount: Number(f.get("amount")),
        currency: String(f.get("currency") || currency),
        note: String(f.get("note") || "") || undefined,
        code: String(f.get("code") || "") || undefined,
      },
    });
    setCreated(r.code);
    await router.invalidate();
  });
  const cancel = useAction(async (id: string) => {
    if (!confirm(t("discounts.gift.cancelConfirm"))) return;
    await cancelGiftCertificateFn({ data: { id } });
    await router.invalidate();
  });
  const tone = { active: "ok", redeemed: "neutral", cancelled: "danger" } as const;
  const label = {
    active: t("discounts.gift.status.active"),
    redeemed: t("discounts.gift.status.redeemed"),
    cancelled: t("discounts.gift.status.cancelled"),
  } as const;
  return (
    <Card title={t("discounts.gift.title")}>
      <form
        className="mb-4 grid gap-3 sm:grid-cols-[1fr_100px_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void create
            .run(new FormData(form))
            .then(() => form.reset())
            .catch(() => {});
        }}
      >
        <Field label={t("discounts.gift.amount")}>
          <input
            className="input"
            name="amount"
            type="number"
            min={1}
            step="1"
            required
            placeholder="5000"
          />
        </Field>
        <Field label={t("discounts.gift.currency")}>
          <input className="input" name="currency" defaultValue={currency} maxLength={3} />
        </Field>
        <Field label={t("discounts.gift.note")}>
          <input
            className="input"
            name="note"
            maxLength={200}
            placeholder={t("discounts.gift.notePlaceholder")}
          />
        </Field>
        <button className="btn-primary self-end" disabled={create.busy}>
          {t("discounts.gift.issue")}
        </button>
      </form>
      {created && (
        <p className="mb-3 text-sm">
          {t("discounts.gift.createdCode")}{" "}
          <code className="rounded bg-surface-2 px-2 py-1 font-mono">{created}</code>{" "}
          {t("discounts.gift.createdHint")}
        </p>
      )}
      <ErrorBox error={create.error ?? cancel.error} />
      {gifts.length === 0 ? (
        <Empty>{t("discounts.gift.empty")}</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("discounts.col.code")}</th>
              <th>{t("discounts.gift.amount")}</th>
              <th>{t("discounts.col.status")}</th>
              <th>{t("discounts.col.note")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gifts.map((g) => (
              <tr key={g.id}>
                <td className="font-mono">{g.code}</td>
                <td className="tabular-nums">{formatMoney(g.amount, g.currency)}</td>
                <td>
                  <Badge tone={tone[g.status as keyof typeof tone] ?? "neutral"}>
                    {label[g.status as keyof typeof label] ?? g.status}
                  </Badge>
                  {g.redeemed_order_id && (
                    <span className="ml-1 text-xs text-muted">
                      {t("discounts.gift.order", { no: g.redeemed_order_id })}
                    </span>
                  )}
                </td>
                <td className="text-muted">{g.note ?? ""}</td>
                <td className="text-right">
                  {g.status === "active" && (
                    <button
                      className="btn-ghost text-xs text-danger"
                      onClick={() => void cancel.run(g.id).catch(() => {})}
                    >
                      {t("discounts.gift.cancel")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ReferralCard({ percent, bot }: { percent: string; bot: string | null }) {
  const router = useRouter();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [value, setValue] = useState(percent);
  const save = useAction(async () => {
    await saveSettingsFn({ data: { referral_discount_percent: value.trim() } });
    await router.invalidate();
  });
  return (
    <Card title={t("discounts.referral.title")}>
      <p className="mb-3 text-sm text-muted">
        {t("discounts.referral.intro", { link: bot ? ` (t.me/${bot}?start=ref_…)` : "" })}
      </p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <Field label={t("discounts.referral.percent")}>
          <input
            className="input w-32"
            type="number"
            min={1}
            max={100}
            step={1}
            placeholder="10"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <button className="btn-secondary" disabled={save.busy}>
          {t("common.save")}
        </button>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}

/** Отчёт «Рефералы»: кто привёл друзей, сколько купили, какие коды выданы; CSV. */
function ReferralReportCard() {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [report, setReport] = useState<Awaited<ReturnType<typeof referralReportFn>>>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    // null — роли не хватает (отчёт видит менеджер и владелец); сбой чтения показываем.
    referralReportFn().then(setReport).catch(setError);
  }, []);
  if (error)
    return (
      <Card title={t("discounts.referral.report.title")} className="lg:col-span-2">
        <ErrorBox error={error} />
      </Card>
    );
  if (!report) return null;
  return (
    <Card title={t("discounts.referral.report.title")} className="lg:col-span-2">
      <p className="mb-3 text-sm text-muted">
        {t("discounts.referral.report.totals", {
          came: report.last30.came,
          bought: report.last30.bought,
          tc: report.total.came,
          tb: report.total.bought,
        })}{" "}
        <a className="underline" href="/api/admin/export/referrals">
          {t("discounts.referral.report.csv")}
        </a>
      </p>
      {report.rows.length === 0 ? (
        <Empty>{t("discounts.referral.report.empty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-3">{t("discounts.referral.report.who")}</th>
                <th className="py-1 pr-3">{t("discounts.referral.report.came")}</th>
                <th className="py-1 pr-3">{t("discounts.referral.report.bought")}</th>
                <th className="py-1">{t("discounts.referral.report.codes")}</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.referrerId} className="border-t border-line align-top">
                  <td className="py-1 pr-3">{r.name}</td>
                  <td className="py-1 pr-3">{r.came}</td>
                  <td className="py-1 pr-3">{r.bought}</td>
                  <td className="py-1">
                    {r.codes.map((c) => (
                      <div key={c.code}>
                        <code>{c.code}</code>
                        {c.used ? ` — ${t("discounts.referral.report.used")}` : ""}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

type TierRow = { name: string; from: string; percent: string };

function TiersCard({ tiers }: { tiers: { name: string; from: number; percent: number }[] }) {
  const router = useRouter();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [rows, setRows] = useState<TierRow[]>(
    tiers.map((x) => ({ name: x.name, from: String(x.from), percent: String(x.percent) })),
  );
  const set = (i: number, patch: Partial<TierRow>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = useAction(async () => {
    await saveLoyaltyTiersFn({
      data: {
        tiers: rows.map((x) => ({
          name: x.name,
          from: Number(x.from),
          percent: Number(x.percent),
        })),
      },
    });
    await router.invalidate();
  });
  return (
    <Card title={t("discounts.tiers.title")}>
      <p className="mb-3 text-sm text-muted">{t("discounts.tiers.intro")}</p>
      {rows.length === 0 && <p className="mb-3 text-sm text-muted">{t("discounts.tiers.empty")}</p>}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Field label={t("discounts.tiers.name")}>
              <input
                className="input w-40"
                maxLength={40}
                value={r.name}
                onChange={(e) => set(i, { name: e.target.value })}
              />
            </Field>
            <Field label={t("discounts.tiers.from")}>
              <input
                className="input w-28"
                type="number"
                min={0}
                value={r.from}
                onChange={(e) => set(i, { from: e.target.value })}
              />
            </Field>
            <Field label={t("discounts.tiers.percent")}>
              <input
                className="input w-24"
                type="number"
                min={1}
                max={100}
                value={r.percent}
                onChange={(e) => set(i, { percent: e.target.value })}
              />
            </Field>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
            >
              {t("discounts.tiers.remove")}
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          {rows.length < 4 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRows((x) => [...x, { name: "", from: "0", percent: "5" }])}
            >
              {t("discounts.tiers.add")}
            </button>
          )}
          <button className="btn-secondary" disabled={save.busy}>
            {t("discounts.tiers.save")}
          </button>
        </div>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}

/** Ограниченные предложения: скидка на товар до даты и, по желанию, на N штук. */
function OffersCard() {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const [data, setData] = useState<Awaited<ReturnType<typeof offersFn>> | null>(null);
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [scope, setScope] = useState<"product" | "category">("product");
  const [mode, setMode] = useState<"percent" | "price">("percent");
  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [percent, setPercent] = useState("20");
  const [newPrice, setNewPrice] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [limit, setLimit] = useState("");
  const reload = async () => setData(await offersFn());
  useEffect(() => {
    void reload();
  }, []);
  // Очередь товаров из отчёта «Залежавшийся товар»: форма берёт их по одному.
  const { offerProducts } = Route.useSearch();
  const [queue, setQueue] = useState<PickerProduct[]>([]);
  useEffect(() => {
    const ids = (offerProducts ?? "")
      .split(",")
      .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
      .slice(0, 20);
    if (!ids.length) return;
    void offerQueueFn({ data: { ids } })
      .then((list) => {
        setQueue(list);
        setScope("product");
        setProduct(list[0] ?? null);
      })
      .catch(() => {});
  }, [offerProducts]);
  const reset = () => {
    setEditId(undefined);
    setProduct(null);
    setCategoryId("");
    setNewPrice("");
    setStarts("");
    setEnds("");
    setLimit("");
    setMode("percent");
    setScope("product");
  };
  const add = useAction(async () => {
    await saveOfferFn({
      data: {
        id: editId,
        scope,
        productId: scope === "product" ? product?.id : undefined,
        categoryId: scope === "category" ? categoryId : undefined,
        mode,
        percent: mode === "percent" ? Number(percent) : undefined,
        newPrice: mode === "price" ? Number(newPrice) : undefined,
        startsAt: starts || null,
        endsAt: ends,
        limit: scope === "product" && limit.trim() ? Number(limit) : null,
      },
    });
    // Следующий товар из очереди: скидка и сроки остаются, меняется только товар.
    if (!editId && queue.length > 1) {
      setQueue(queue.slice(1));
      setProduct(queue[1] ?? null);
    } else {
      setQueue([]);
      reset();
    }
    await reload();
  });
  const del = useAction(async (id: string) => {
    await deleteOfferFn({ data: { id } });
    await reload();
  });
  const announce = useAction(async (id: string) => {
    if (!confirm(t("discounts.offers.announceConfirm"))) return;
    await announceOfferFn({ data: { id } });
    await reload();
  });
  const end = useAction(async (id: string) => {
    if (!confirm(t("discounts.offers.endConfirm"))) return;
    await endOfferFn({ data: { id } });
    await reload();
  });
  const name = new Map((data?.products ?? []).map((p) => [p.id, p.name]));
  const catName = new Map((data?.categories ?? []).map((c) => [c.id, c.name]));
  const tz = data?.timezone ?? "UTC";
  const now = Date.now();
  const edit = (o: NonNullable<typeof data>["offers"][number]) => {
    setEditId(o.id);
    setScope(o.category_id ? "category" : "product");
    setMode(o.new_price != null ? "price" : "percent");
    setProduct(
      o.product_id
        ? ({ id: o.product_id, name: name.get(o.product_id) ?? "" } as PickerProduct)
        : null,
    );
    setCategoryId(o.category_id ?? "");
    setPercent(String(o.percent));
    setNewPrice(o.new_price != null ? String(o.new_price) : "");
    setStarts(utcToZonedLocal(o.starts_at, tz));
    setEnds(utcToZonedLocal(o.ends_at, tz));
    setLimit(o.limit != null ? String(o.limit) : "");
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString(loc, { dateStyle: "short", timeStyle: "short", timeZone: tz });
  return (
    <Card title={t("discounts.offers.title")} className="lg:col-span-2">
      <p className="mb-3 text-sm text-muted">{t("discounts.offers.intro")}</p>
      {queue.length > 0 && (
        <p className="mb-3 rounded border border-line bg-surface-2 p-2 text-sm">
          {t("discounts.offers.queue", { n: queue.length })}
        </p>
      )}
      <form
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void add.run().catch(() => {});
        }}
      >
        <select
          className="input"
          aria-label={t("discounts.offers.scope")}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as "product" | "category");
            if (e.target.value === "category") setMode("percent");
          }}
        >
          <option value="product">{t("discounts.offers.scopeProduct")}</option>
          <option value="category">{t("discounts.offers.scopeCategory")}</option>
        </select>
        {scope === "product" ? (
          <div aria-label={t("discounts.offers.product")}>
            <ProductPicker t={t} value={product} onChange={setProduct} />
          </div>
        ) : (
          <select
            className="input"
            aria-label={t("discounts.offers.category")}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            <option value="">{t("discounts.offers.category")}</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select
          className="input"
          aria-label={t("discounts.offers.mode")}
          value={mode}
          disabled={scope === "category"}
          onChange={(e) => setMode(e.target.value as "percent" | "price")}
        >
          <option value="percent">{t("discounts.offers.modePercent")}</option>
          <option value="price">{t("discounts.offers.modePrice")}</option>
        </select>
        {mode === "percent" ? (
          <input
            className="input"
            type="number"
            min={1}
            max={99}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            placeholder="%"
            aria-label="%"
            required
          />
        ) : (
          <input
            className="input"
            type="number"
            min={1}
            step="any"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder={t("discounts.offers.newPrice")}
            aria-label={t("discounts.offers.newPrice")}
            required
          />
        )}
        <label className="text-xs text-muted">
          {t("discounts.offers.from")}
          <input
            className="input"
            type="datetime-local"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
          />
        </label>
        <label className="text-xs text-muted">
          {t("discounts.offers.until")}
          <input
            className="input"
            type="datetime-local"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
            required
          />
        </label>
        <input
          className="input self-end"
          type="number"
          min={1}
          value={limit}
          disabled={scope === "category"}
          onChange={(e) => setLimit(e.target.value)}
          placeholder={t("discounts.offers.limit")}
          aria-label={t("discounts.offers.limit")}
        />
        <div className="flex gap-2 self-end">
          <button
            className="btn-primary"
            disabled={add.busy || (scope === "product" ? !product : !categoryId)}
          >
            {editId ? t("discounts.offers.save") : t("discounts.offers.add")}
          </button>
          {editId && (
            <button type="button" className="btn-secondary" onClick={reset}>
              {t("common.cancel")}
            </button>
          )}
        </div>
      </form>
      <p className="mt-2 text-xs text-muted">
        {t("discounts.offers.tz")} {tz}
      </p>
      <ErrorBox error={add.error ?? del.error ?? end.error ?? announce.error} />
      {data && data.offers.length === 0 && (
        <p className="mt-3 text-sm text-muted">{t("discounts.offers.empty")}</p>
      )}
      {data && data.offers.length > 0 && (
        <table className="table mt-3">
          <thead>
            <tr>
              <th>{t("discounts.offers.product")}</th>
              <th>{t("discounts.offers.discount")}</th>
              <th>{t("discounts.offers.period")}</th>
              <th>{t("discounts.offers.sold")}</th>
              <th>{t("discounts.col.status")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.offers.map((o) => {
              const running =
                Date.parse(o.starts_at) <= now && now < Date.parse(o.ends_at) && (o.left ?? 1) > 0;
              const planned = Date.parse(o.starts_at) > now;
              return (
                <tr key={o.id}>
                  <td>
                    {o.category_id
                      ? `${t("discounts.offers.scopeCategory")}: ${catName.get(o.category_id) ?? "—"}`
                      : (name.get(o.product_id) ?? "—")}
                  </td>
                  <td className="tabular-nums">
                    {o.new_price != null ? `${o.new_price} (−${o.percent}%)` : `−${o.percent}%`}
                  </td>
                  <td className="text-muted">
                    {when(o.starts_at)} — {when(o.ends_at)}
                  </td>
                  <td className="tabular-nums">
                    {o.category_id ? "—" : o.sold}
                    {o.limit != null && ` / ${o.limit}`}
                  </td>
                  <td>
                    {running ? (
                      <Badge tone="ok">{t("discounts.offers.running")}</Badge>
                    ) : planned ? (
                      <Badge>{t("discounts.offers.planned")}</Badge>
                    ) : (
                      <Badge>{t("discounts.offers.ended")}</Badge>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => edit(o)}>
                      {t("common.edit")}
                    </button>
                    {(running || planned) && shop.modules.broadcasts && !o.announced_at && (
                      <button
                        className="btn-ghost text-xs"
                        disabled={announce.busy}
                        onClick={() => void announce.run(o.id).catch(() => {})}
                      >
                        {t("discounts.offers.announce")}
                      </button>
                    )}
                    {o.announced_at && <Badge>{t("discounts.offers.announced")}</Badge>}
                    {(running || planned) && (
                      <button
                        className="btn-ghost text-xs"
                        disabled={end.busy}
                        onClick={() => void end.run(o.id).catch(() => {})}
                      >
                        {t("discounts.offers.end")}
                      </button>
                    )}
                    <button
                      className="btn-ghost text-xs text-danger"
                      disabled={del.busy}
                      onClick={() => void del.run(o.id).catch(() => {})}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

type GiftSale = Awaited<ReturnType<typeof giftSaleFn>>;

/** Продажа сертификатов на витрине сайта: переключатель, номиналы и валюта. */
function GiftSaleCard({ sale }: { sale: GiftSale }) {
  const router = useRouter();
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    setSaved(false);
    await saveGiftSaleFn({
      data: {
        enabled: f.get("enabled") === "on",
        amounts: String(f.get("amounts") ?? "")
          .split(/[,;\s]+/)
          .map((x) => Number(x.replace(/[^\d]/g, "")))
          .filter((x) => x > 0),
        currency: String(f.get("currency") || "KZT"),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  return (
    <Card title={t("discounts.gift.sale.title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={sale.enabled} />
          {t("discounts.gift.sale.enabled")}
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
          <Field label={t("discounts.gift.sale.amounts")}>
            <input
              className="input"
              name="amounts"
              defaultValue={sale.amounts.join(", ")}
              placeholder="5000, 10000, 20000"
            />
          </Field>
          <Field label={t("discounts.gift.currency")}>
            <input className="input" name="currency" defaultValue={sale.currency} maxLength={3} />
          </Field>
        </div>
        <p className="text-xs text-muted">{t("discounts.gift.sale.hint")}</p>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            {t("discounts.gift.sale.save")}
          </button>
          {saved && <span className="text-sm text-muted">{t("discounts.gift.sale.saved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
