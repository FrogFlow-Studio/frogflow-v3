import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  cancelGiftCertificateFn,
  createGiftCertificateFn,
  deletePromoCodeFn,
  giftCertificatesFn,
  promoCodesFn,
  savePromoCodeFn,
  saveSettingsFn,
  settingsFn,
} from "@/app/admin/admin.functions";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";

export const Route = createFileRoute("/admin/_authed/discounts")({
  loader: async () => {
    const [promos, gifts, settings] = await Promise.all([
      promoCodesFn(),
      giftCertificatesFn(),
      settingsFn(),
    ]);
    return { promos, gifts, referralPercent: settings.settings.referral_discount_percent ?? "" };
  },
  component: DiscountsPage,
});

type Promo = Awaited<ReturnType<typeof promoCodesFn>>[number];

function DiscountsPage() {
  const { promos, gifts, referralPercent } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  return (
    <>
      <PageTitle
        title="Скидки"
        subtitle="Промокоды и подарочные сертификаты покупатель вводит в корзине бота"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {shop.modules.coupons && <PromoCard promos={promos} />}
        {shop.modules.gift_certificates && (
          <GiftCard gifts={gifts} currency={promos[0] ? "KZT" : "KZT"} />
        )}
        {shop.modules.referral && <ReferralCard percent={referralPercent} bot={shop.telegram} />}
      </div>
    </>
  );
}

function PromoCard({ promos }: { promos: Promo[] }) {
  const router = useRouter();
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
      },
    });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm("Удалить промокод?")) return;
    await deletePromoCodeFn({ data: { id } });
    await router.invalidate();
  });
  const cur = editing === "new" ? null : editing;
  return (
    <Card
      title="Промокоды"
      actions={
        <button className="btn-secondary text-xs" onClick={() => setEditing("new")}>
          + Промокод
        </button>
      }
    >
      {promos.length === 0 ? (
        <Empty>Промокодов пока нет.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Код</th>
              <th>Скидка</th>
              <th>Использований</th>
              <th>Действует до</th>
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
                    {p.code} {!p.is_active && <Badge>выкл</Badge>}
                    {expired && <Badge tone="warn">истёк</Badge>}
                    {exhausted && <Badge tone="warn">исчерпан</Badge>}
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
                    {p.valid_until ? new Date(p.valid_until).toLocaleDateString("ru") : "бессрочно"}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => setEditing(p)}>
                      Изменить
                    </button>
                    <button
                      className="btn-ghost text-xs text-danger"
                      onClick={() => void del.run(p.id).catch(() => {})}
                    >
                      Удалить
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
            <Field label="Код">
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
            <Field label="Тип">
              <select
                className="input"
                name="discountType"
                defaultValue={cur?.discount_type ?? "percent"}
              >
                <option value="percent">Процент</option>
                <option value="fixed">Сумма</option>
              </select>
            </Field>
            <Field label="Значение">
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
            <Field label="Лимит использований" hint="Пусто — без лимита.">
              <input
                className="input"
                name="maxUses"
                type="number"
                min={1}
                defaultValue={cur?.max_uses ?? ""}
              />
            </Field>
            <Field label="Действует до">
              <input
                className="input"
                name="validUntil"
                type="date"
                defaultValue={cur?.valid_until ? cur.valid_until.slice(0, 10) : ""}
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={cur?.is_active ?? true} />{" "}
              Активен
            </label>
          </div>
          <ErrorBox error={save.error} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={save.busy}>
              Сохранить
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              Отмена
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
    if (!confirm("Аннулировать сертификат?")) return;
    await cancelGiftCertificateFn({ data: { id } });
    await router.invalidate();
  });
  const tone = { active: "ok", redeemed: "neutral", cancelled: "danger" } as const;
  const label = { active: "активен", redeemed: "использован", cancelled: "аннулирован" } as const;
  return (
    <Card title="Подарочные сертификаты">
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
        <Field label="Номинал">
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
        <Field label="Валюта">
          <input className="input" name="currency" defaultValue={currency} maxLength={3} />
        </Field>
        <Field label="Кому / заметка">
          <input
            className="input"
            name="note"
            maxLength={200}
            placeholder="Для Айгерим, день рождения"
          />
        </Field>
        <button className="btn-primary self-end" disabled={create.busy}>
          Выпустить
        </button>
      </form>
      {created && (
        <p className="mb-3 text-sm">
          Код сертификата:{" "}
          <code className="rounded bg-surface-2 px-2 py-1 font-mono">{created}</code> — передайте
          покупателю.
        </p>
      )}
      <ErrorBox error={create.error ?? cancel.error} />
      {gifts.length === 0 ? (
        <Empty>Сертификатов пока нет.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Код</th>
              <th>Номинал</th>
              <th>Статус</th>
              <th>Заметка</th>
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
                    <span className="ml-1 text-xs text-muted">заказ #{g.redeemed_order_id}</span>
                  )}
                </td>
                <td className="text-muted">{g.note ?? ""}</td>
                <td className="text-right">
                  {g.status === "active" && (
                    <button
                      className="btn-ghost text-xs text-danger"
                      onClick={() => void cancel.run(g.id).catch(() => {})}
                    >
                      Аннулировать
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
  const [value, setValue] = useState(percent);
  const save = useAction(async () => {
    await saveSettingsFn({ data: { referral_discount_percent: value.trim() } });
    await router.invalidate();
  });
  return (
    <Card title="Реферальная программа">
      <p className="mb-3 text-sm text-muted">
        Покупатель делится ссылкой из раздела «ℹ️ Информация» в боте
        {bot ? ` (t.me/${bot}?start=ref_…)` : ""}. Приглашённый сразу получает одноразовый промокод
        на первую покупку, пригласивший — такой же после первой выданной покупки друга. Промокоды
        WELCOME-… и REF-… появляются в списке слева.
      </p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <Field label="Скидка по промокоду, %">
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
          Сохранить
        </button>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}
