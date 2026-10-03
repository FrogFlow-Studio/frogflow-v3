import { useEffect, useState } from "react";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { minOrderFn, saveMinOrderFn } from "@/app/admin/min-order.functions";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

/**
 * Минимальная сумма заказа в валюте магазина: бот, сайт и Instagram/WhatsApp не
 * дают оформить меньше и говорят покупателю, сколько добрать. 0 — без минимума.
 * Владелец меняет, остальные видят.
 */
export function MinOrderCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [value, setValue] = useState<string | null>(null);
  const [currency, setCurrency] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void minOrderFn().then((r) => {
      setValue(String(r.amount));
      setCurrency(r.currency);
    });
  }, []);
  const owner = shop.role === "owner";
  const save = useAction(async () => {
    await saveMinOrderFn({ data: { amount: Number((value ?? "").replace(",", ".")) || 0 } });
    setSaved(true);
  });
  return (
    <Card title={t("settings.minOrder.title")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.minOrder.intro")}</p>
        <Field
          label={t("settings.minOrder.label", { cur: currency })}
          hint={t("settings.minOrder.hint")}
        >
          <input
            className="input w-40"
            inputMode="decimal"
            value={value ?? ""}
            disabled={!owner || value === null}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {owner && (
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={save.busy || value === null}>
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
