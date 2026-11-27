import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { saveSettingsFn } from "@/app/admin/settings.functions";
import { Card, ErrorBox, Field, Switch, useAction } from "@/app/ui";
import { adminT } from "@/app/i18n/admin";
import { roleAllows } from "@/core/auth/roles";
import { sheetCsvUrl } from "@/core/catalog/sheet";
import { PRINT3D_AUTO_KEY, PRINT3D_READY_KEY, PRINT3D_SHEET_KEY } from "@/core/print3d/sheet";
import { settingsRoute } from "./route";

/** Таблица заказов, рабочая группа и уведомления студии. */
export function Print3dCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [url, setUrl] = useState(settings[PRINT3D_SHEET_KEY] ?? "");
  const [group, setGroup] = useState(settings.admin_chat_id ?? "");
  const [ready, setReady] = useState(settings[PRINT3D_READY_KEY] === "true");
  const [auto, setAuto] = useState(settings[PRINT3D_AUTO_KEY] === "true");
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    await saveSettingsFn({
      data: {
        [PRINT3D_SHEET_KEY]: url.trim(),
        admin_chat_id: group.trim(),
        [PRINT3D_AUTO_KEY]: String(auto),
        [PRINT3D_READY_KEY]: String(ready),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const readOnly = save.busy || !roleAllows(shop.role, "admin");
  const bad = url.trim() !== "" && !sheetCsvUrl(url);
  return (
    <Card title={t("settings.print3d.title")}>
      <p className="mb-3 text-sm text-muted">{t("settings.print3d.intro")}</p>
      <form
        className="space-y-3"
        onChange={() => setSaved(false)}
        onSubmit={(e) => {
          e.preventDefault();
          if (bad) return;
          void save.run().catch(() => {});
        }}
      >
        <Field
          label={t("settings.print3d.sheet")}
          hint={bad ? t("settings.print3d.badLink") : t("settings.print3d.sheetHint")}
        >
          <input
            className="input"
            type="url"
            name={PRINT3D_SHEET_KEY}
            value={url}
            disabled={readOnly}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field label={t("settings.print3d.group")} hint={t("settings.print3d.groupHint")}>
          <input
            className="input"
            name="admin_chat_id"
            value={group}
            disabled={readOnly}
            onChange={(e) => setGroup(e.target.value)}
          />
        </Field>
        <div className="space-y-3 border-t border-line pt-3">
          <div>
            <div className="flex items-center gap-3">
              <Switch
                checked={auto}
                disabled={readOnly}
                onChange={(v) => {
                  setAuto(v);
                  setSaved(false);
                }}
                label={t("settings.print3d.auto")}
              />
              <span className="text-sm">{t("settings.print3d.auto")}</span>
            </div>
            <p className="mt-1 text-xs text-muted">{t("settings.print3d.autoHint")}</p>
          </div>
          <div>
            <div className="flex items-center gap-3">
              <Switch
                checked={ready}
                disabled={readOnly}
                onChange={(v) => {
                  setReady(v);
                  setSaved(false);
                }}
                label={t("settings.print3d.ready")}
              />
              <span className="text-sm">{t("settings.print3d.ready")}</span>
            </div>
            <p className="mt-1 text-xs text-muted">{t("settings.print3d.readyHint")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" type="submit" disabled={readOnly || bad}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}
