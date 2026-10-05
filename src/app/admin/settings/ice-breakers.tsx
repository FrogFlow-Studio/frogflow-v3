import { useEffect, useState } from "react";
import { Card, ErrorBox, Switch, useAction } from "@/app/ui";
import { iceBreakersFn, saveIceBreakersFn } from "@/app/admin/channels.functions";
import { ICE_BREAKER_QUESTION_MAX, type IceBreakersConfig } from "@/core/instagram/ice-breakers";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";
import { roleAllows } from "@/core/auth/roles";

/**
 * Быстрые вопросы Instagram (core/instagram/ice-breakers): тумблер, по
 * умолчанию выключен; четыре подсказки с изменяемым текстом.
 */
export function IceBreakersCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [s, setS] = useState<IceBreakersConfig | null>(null);
  const [saved, setSaved] = useState<"ok" | "pending" | null>(null);
  useEffect(() => {
    void iceBreakersFn().then(setS);
  }, []);
  const save = useAction(async () => {
    if (!s) return;
    const r = await saveIceBreakersFn({ data: s });
    setSaved(r.applied ? "ok" : "pending");
  });
  const owner = roleAllows(shop.role, "admin");
  const setItem = (i: number, patch: Partial<IceBreakersConfig["items"][number]>) =>
    s && setS({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <Card
      title={t("settings.ib.title")}
      actions={
        s && (
          <Switch
            checked={s.enabled}
            onChange={(on) => owner && setS({ ...s, enabled: on })}
            label={t("settings.ib.enabled")}
          />
        )
      }
    >
      {!s ? (
        <p className="text-sm text-muted">…</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(null);
            void save.run().catch(() => {});
          }}
        >
          <p className="text-sm text-muted">{t("settings.ib.intro")}</p>
          {s.items.map((item, i) => (
            <label key={item.kind} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.on}
                disabled={!owner}
                aria-label={t(`settings.ib.kind.${item.kind}`)}
                onChange={(e) => setItem(i, { on: e.target.checked })}
              />
              <input
                className="input"
                value={item.question}
                maxLength={ICE_BREAKER_QUESTION_MAX}
                disabled={!owner || !item.on}
                placeholder={t(`settings.ib.kind.${item.kind}`)}
                onChange={(e) => setItem(i, { question: e.target.value })}
              />
            </label>
          ))}
          <p className="text-xs text-muted">{t("settings.ib.needsShop")}</p>
          {owner && (
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={save.busy}>
                {t("common.save")}
              </button>
              {saved === "ok" && <span className="text-sm text-ok">{t("settings.saved")}</span>}
              {saved === "pending" && (
                <span className="text-sm text-muted">{t("settings.ib.notApplied")}</span>
              )}
            </div>
          )}
          <ErrorBox error={save.error} />
        </form>
      )}
    </Card>
  );
}
