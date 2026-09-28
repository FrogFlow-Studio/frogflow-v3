import { createFileRoute, useRouteContext, useRouter } from "@tanstack/react-router";
import { ProductPicker, type PickerProduct } from "@/app/admin/product-picker";
import { useEffect, useState } from "react";
import { deleteOfferFn, offersFn, saveOfferFn } from "@/app/admin/offers.functions";
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
import { adminT, intlLocale } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";

export const Route = createFileRoute("/admin/_authed/discounts")({
  loader: async () => {
    const [promos, gifts, settings, giftSale] = await Promise.all([
      promoCodesFn(),
      giftCertificatesFn(),
      settingsFn(),
      giftSaleFn(),
    ]);
    return {
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
  const { promos, gifts, giftSale, referralPercent } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  return (
    <>
      <PageTitle title={t("discounts.title")} subtitle={t("discounts.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-2">
        {shop.modules.coupons && <PromoCard promos={promos} />}
        {shop.modules.gift_certificates && (
          <GiftCard gifts={gifts} currency={promos[0] ? "KZT" : "KZT"} />
        )}
        {shop.modules.gift_certificates && <GiftSaleCard sale={giftSale} />}
        {shop.modules.referral && <ReferralCard percent={referralPercent} bot={shop.telegram} />}
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

/** Ограниченные предложения: скидка на товар до даты и, по желанию, на N штук. */
function OffersCard() {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const [data, setData] = useState<Awaited<ReturnType<typeof offersFn>> | null>(null);
  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [percent, setPercent] = useState("20");
  const [ends, setEnds] = useState("");
  const [limit, setLimit] = useState("");
  const reload = async () => setData(await offersFn());
  useEffect(() => {
    void reload();
  }, []);
  const add = useAction(async () => {
    await saveOfferFn({
      data: {
        productId: product?.id ?? "",
        percent: Number(percent),
        startsAt: null,
        endsAt: new Date(ends).toISOString(),
        limit: limit.trim() ? Number(limit) : null,
      },
    });
    setLimit("");
    setProduct(null);
    await reload();
  });
  const del = useAction(async (id: string) => {
    await deleteOfferFn({ data: { id } });
    await reload();
  });
  const name = new Map((data?.products ?? []).map((p) => [p.id, p.name]));
  const now = Date.now();
  return (
    <Card title={t("discounts.offers.title")} className="lg:col-span-2">
      <p className="mb-3 text-sm text-muted">{t("discounts.offers.intro")}</p>
      <form
        className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void add.run().catch(() => {});
        }}
      >
        <div aria-label={t("discounts.offers.product")}>
          <ProductPicker t={t} value={product} onChange={setProduct} />
        </div>
        <input
          className="input"
          type="number"
          min={1}
          max={99}
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          placeholder="%"
          required
        />
        <input
          className="input"
          type="datetime-local"
          value={ends}
          onChange={(e) => setEnds(e.target.value)}
          required
        />
        <input
          className="input"
          type="number"
          min={1}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder={t("discounts.offers.limit")}
        />
        <button className="btn-primary" disabled={add.busy || !product}>
          {t("discounts.offers.add")}
        </button>
      </form>
      <ErrorBox error={add.error ?? del.error} />
      {data && data.offers.length === 0 && (
        <p className="mt-3 text-sm text-muted">{t("discounts.offers.empty")}</p>
      )}
      {data && data.offers.length > 0 && (
        <table className="table mt-3">
          <thead>
            <tr>
              <th>{t("discounts.offers.product")}</th>
              <th>%</th>
              <th>{t("discounts.offers.until")}</th>
              <th>{t("discounts.offers.sold")}</th>
              <th>{t("discounts.col.status")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.offers.map((o) => {
              const running =
                Date.parse(o.starts_at) <= now && now < Date.parse(o.ends_at) && (o.left ?? 1) > 0;
              return (
                <tr key={o.id}>
                  <td>{name.get(o.product_id) ?? "—"}</td>
                  <td className="tabular-nums">−{o.percent}%</td>
                  <td className="text-muted">
                    {new Date(o.ends_at).toLocaleString(loc, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="tabular-nums">
                    {o.sold}
                    {o.limit != null && ` / ${o.limit}`}
                  </td>
                  <td>
                    {running ? (
                      <Badge tone="ok">{t("discounts.offers.running")}</Badge>
                    ) : (
                      <Badge>{t("discounts.offers.ended")}</Badge>
                    )}
                  </td>
                  <td className="text-right">
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
