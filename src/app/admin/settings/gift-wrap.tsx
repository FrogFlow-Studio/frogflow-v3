import { useEffect, useState } from "react";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { giftWrapFn, saveGiftWrapFn } from "@/app/admin/gift-wrap.functions";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

/**
 * Подарочная упаковка: включить и поставить цену в валюте магазина. Покупатель,
 * отметивший заказ подарком, может её взять; она отдельной строкой в сумме заказа.
 * Владелец меняет, остальные видят.
 */
export function GiftWrapCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [on, setOn] = useState(false);
  const [price, setPrice] = useState<string | null>(null);
  const [currency, setCurrency] = useState("");
  const [ask, setAsk] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void giftWrapFn().then((r) => {
      setOn(r.on);
      setPrice(r.price > 0 ? String(r.price) : "");
      setCurrency(r.currency);
      setAsk(r.ask);
    });
  }, []);
  const owner = shop.role === "owner";
  const save = useAction(async () => {
    const r = await saveGiftWrapFn({
      data: { on, price: Number((price ?? "").replace(",", ".")) || 0, ask },
    });
    setOn(r.on);
    setAsk(r.ask);
    setPrice(r.price > 0 ? String(r.price) : "");
    setSaved(true);
  });
  return (
    <Card title={t("settings.giftWrap.title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.giftWrap.intro")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={on}
            disabled={!owner || price === null}
            onChange={(e) => setOn(e.target.checked)}
          />
          {t("settings.giftWrap.on")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ask}
            disabled={!owner || price === null}
            onChange={(e) => setAsk(e.target.checked)}
          />
          {t("settings.giftWrap.ask")}
        </label>
        <p className="-mt-2 text-xs text-muted">{t("settings.giftWrap.askHint")}</p>
        <Field label={t("settings.giftWrap.price", { cur: currency })}>
          <input
            className="input w-40"
            inputMode="decimal"
            value={price ?? ""}
            disabled={!owner || price === null}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        {owner && (
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={save.busy || price === null}>
              {t("common.save")}
            </button>
            {saved && <span className="text-sm text-ok">{t("settings.saved")}</span>}
          </div>
        )}
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
