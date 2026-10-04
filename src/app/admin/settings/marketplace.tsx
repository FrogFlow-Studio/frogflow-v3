import { useEffect, useState } from "react";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { marketplaceFn, saveMarketplaceListingFn } from "@/app/admin/marketplace.functions";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

type View = Awaited<ReturnType<typeof marketplaceFn>>;

/**
 * Площадка FrogFlow: выключатель «Показывать на площадке». По умолчанию выключено.
 * Меняет владелец; скрытие оператором выключатель не снимает, но магазин не показывается.
 */
export function MarketplaceCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [view, setView] = useState<View | null>(null);
  const [saved, setSaved] = useState(false);
  const owner = shop.role === "owner";
  const [listed, setListed] = useState(false);
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const fill = (v: View) => {
    setView(v);
    setListed(v.listed);
    setCategory(v.category);
    setCity(v.city);
  };
  useEffect(() => {
    void marketplaceFn().then(fill);
  }, []);
  const save = useAction(async () => {
    fill(await saveMarketplaceListingFn({ data: { listed, category, city } }));
    setSaved(true);
  });
  const locked = !owner || view === null;
  return (
    <Card title={t("settings.market.title")}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t("settings.market.intro")}</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            void save.run().catch(() => {});
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={listed}
              disabled={locked}
              onChange={(e) => setListed(e.currentTarget.checked)}
            />
            {t("settings.market.on")}
          </label>
          <Field label={t("settings.market.category", { def: view?.defaultCategory ?? "" })}>
            <input
              className="input"
              maxLength={60}
              value={category}
              disabled={locked}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Field>
          <Field label={t("settings.market.city")}>
            <input
              className="input"
              maxLength={60}
              value={city}
              disabled={locked}
              onChange={(e) => setCity(e.target.value)}
            />
          </Field>
          {owner && (
            <button className="btn-primary" disabled={save.busy || view === null}>
              {t("settings.market.save")}
            </button>
          )}
        </form>
        <p className="text-xs text-muted">
          {t("settings.market.terms")}{" "}
          <a href="/market/rules" target="_blank" rel="noreferrer" className="underline">
            {t("settings.market.rules")}
          </a>
        </p>
        {view && <p className="text-sm">{t(`settings.market.state.${view.state}`)}</p>}
        {view?.state === "hidden" && view.hiddenReason && (
          <p className="text-sm text-muted">
            {t("settings.market.reason", { reason: view.hiddenReason })}
          </p>
        )}
        {!owner && <p className="text-xs text-muted">{t("settings.market.ownerOnly")}</p>}
        {saved && <span className="text-sm text-ok">{t("settings.saved")}</span>}
        <ErrorBox error={save.error} />
      </div>
    </Card>
  );
}
