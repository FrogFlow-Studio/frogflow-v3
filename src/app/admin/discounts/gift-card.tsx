import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  cancelGiftCertificateFn,
  createGiftCertificateFn,
  giftCertificatesFn,
} from "@/app/admin/promos.functions";
import { adminT } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, Field, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";

/** Подарочные сертификаты. */

type Gift = Awaited<ReturnType<typeof giftCertificatesFn>>[number];

export function GiftCard({ gifts, currency }: { gifts: Gift[]; currency: string }) {
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
