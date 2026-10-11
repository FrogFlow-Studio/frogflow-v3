import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { giftSaleFn, saveGiftSaleFn } from "@/app/admin/promos.functions";
import { adminT } from "@/app/i18n/admin";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { HelpTip } from "@/app/admin/help-panel";

/** Продажа подарочных сертификатов. */

type GiftSale = Awaited<ReturnType<typeof giftSaleFn>>;

/** Продажа сертификатов на витрине сайта: переключатель, номиналы и валюта. */
export function GiftSaleCard({ sale }: { sale: GiftSale }) {
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
    <Card
      title={
        <span className="flex items-center gap-1.5">
          {t("discounts.gift.sale.title")}
          <HelpTip article="discounts" anchor="gift-sale" />
        </span>
      }
    >
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
          <HelpTip article="discounts" anchor="gift-sale" />
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
