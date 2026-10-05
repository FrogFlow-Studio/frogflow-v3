import { useEffect, useState } from "react";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { saveStoreAboutFn, storeAboutFn } from "@/app/admin/about.functions";
import { adminT } from "@/app/i18n/admin";
import { ABOUT_LIMITS, EMPTY_ABOUT, type StoreAbout } from "@/core/storefront/about";
import { AsBuyerButton } from "./as-buyer";
import { settingsRoute } from "./route";

const FIELDS = ["description", "delivery", "payment"] as const;
const LINES = ["phone", "address", "hours"] as const;

/** «О магазине»: свои слова продавца для страницы /s/<магазин>/about. Меняет владелец. */
export function AboutCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [v, setV] = useState<StoreAbout>(EMPTY_ABOUT);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void storeAboutFn().then((a) => {
      setV(a);
      setReady(true);
    });
  }, []);
  const owner = shop.role === "owner";
  const locked = !owner || !ready;
  const save = useAction(async () => {
    setV(await saveStoreAboutFn({ data: v }));
    setSaved(true);
  });
  const set = (k: keyof StoreAbout) => (value: string) => {
    setSaved(false);
    setV((cur) => ({ ...cur, [k]: value }));
  };
  return (
    <Card title={t("settings.about.title")}>
      <div className="mb-4">
        <AsBuyerButton slug={shop.slug} locale={shop.locale} />
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.about.intro")}</p>
        <Field label={t("settings.about.description")}>
          <textarea
            className="input"
            rows={4}
            maxLength={ABOUT_LIMITS.description}
            value={v.description}
            disabled={locked}
            onChange={(e) => set("description")(e.target.value)}
          />
        </Field>
        {LINES.map((k) => (
          <Field key={k} label={t(`settings.about.${k}`)}>
            <input
              className="input"
              maxLength={ABOUT_LIMITS[k]}
              value={v[k]}
              disabled={locked}
              onChange={(e) => set(k)(e.target.value)}
            />
          </Field>
        ))}
        {FIELDS.slice(1).map((k) => (
          <Field key={k} label={t(`settings.about.${k}`)}>
            <textarea
              className="input"
              rows={3}
              maxLength={ABOUT_LIMITS[k]}
              value={v[k]}
              disabled={locked}
              onChange={(e) => set(k)(e.target.value)}
            />
          </Field>
        ))}
        <div className="flex items-center gap-3">
          {owner ? (
            <button className="btn-primary" disabled={save.busy || !ready}>
              {t("common.save")}
            </button>
          ) : (
            <span className="text-xs text-muted">{t("settings.about.ownerOnly")}</span>
          )}
          {saved && <span className="text-sm text-ok">{t("settings.saved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
