import { useEffect, useState } from "react";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { freeDeliveryFn, saveFreeDeliveryFn } from "@/app/admin/free-delivery.functions";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

const num = (v: string) => Number(v.replace(",", ".")) || 0;

/**
 * Бесплатная доставка от суммы товаров после скидок: общий порог и порог по
 * зонам (зона важнее общего). Бот, сайт и Instagram/WhatsApp подсказывают
 * покупателю, сколько добрать; решает сервер при оформлении. Владелец меняет,
 * остальные видят.
 */
export function FreeDeliveryCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [general, setGeneral] = useState<string | null>(null);
  const [zones, setZones] = useState<Array<{ id: string; name: string; from: string }>>([]);
  const [currency, setCurrency] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void freeDeliveryFn().then((r) => {
      setGeneral(String(r.general));
      setZones(r.zones.map((z) => ({ ...z, from: z.from ? String(z.from) : "" })));
      setCurrency(r.currency);
    });
  }, []);
  const owner = shop.role === "owner";
  const save = useAction(async () => {
    await saveFreeDeliveryFn({
      data: {
        general: num(general ?? ""),
        zones: Object.fromEntries(zones.map((z) => [z.id, num(z.from)])),
      },
    });
    setSaved(true);
  });
  return (
    <Card title={t("settings.freeDelivery.title")}>
      <form
        className="space-y-3"
        data-testid="free-delivery-card"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.freeDelivery.intro")}</p>
        <Field
          label={t("settings.freeDelivery.general", { cur: currency })}
          hint={t("settings.freeDelivery.hint")}
        >
          <input
            className="input w-40"
            inputMode="decimal"
            value={general ?? ""}
            disabled={!owner || general === null}
            onChange={(e) => setGeneral(e.target.value)}
          />
        </Field>
        {zones.map((z) => (
          <Field
            key={z.id}
            label={t("settings.freeDelivery.zone", { name: z.name, cur: currency })}
          >
            <input
              className="input w-40"
              inputMode="decimal"
              value={z.from}
              placeholder={t("settings.freeDelivery.zonePlaceholder")}
              disabled={!owner}
              onChange={(e) =>
                setZones((all) =>
                  all.map((x) => (x.id === z.id ? { ...x, from: e.target.value } : x)),
                )
              }
            />
          </Field>
        ))}
        {owner && (
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={save.busy || general === null}>
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
