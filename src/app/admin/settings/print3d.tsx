import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { saveSettingsFn } from "@/app/admin/settings.functions";
import { Card, ErrorBox, Field, Switch, useAction } from "@/app/ui";
import { adminT } from "@/app/i18n/admin";
import { roleAllows } from "@/core/auth/roles";
import { sheetCsvUrl } from "@/core/catalog/sheet";
import { PRINT3D_READY_KEY, PRINT3D_SHEET_KEY } from "@/core/print3d/sheet";
import { settingsRoute } from "./route";

/**
 * Студия 3D-печати (ниша print3d): ссылка на таблицу заказов и переключатель
 * «писать клиенту „заказ готов“». Рабочая группа — admin_chat_id из раздела «Магазин».
 */
export function Print3dCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [url, setUrl] = useState(settings[PRINT3D_SHEET_KEY] ?? "");
  const [saved, setSaved] = useState(false);
  const ready = settings[PRINT3D_READY_KEY] === "true";
  const save = useAction(async (data: Record<string, string>) => {
    setSaved(false);
    await saveSettingsFn({ data });
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
        onSubmit={(e) => {
          e.preventDefault();
          if (bad) return;
          void save.run({ [PRINT3D_SHEET_KEY]: url.trim() }).catch(() => {});
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
        <div className="flex items-center gap-3">
          <button className="btn-primary" type="submit" disabled={readOnly || bad}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
      </form>
      <div className="mt-4 flex items-center gap-3">
        <Switch
          checked={ready}
          disabled={readOnly}
          onChange={(v) =>
            void save.run({ [PRINT3D_READY_KEY]: v ? "true" : "false" }).catch(() => {})
          }
          label={t("settings.print3d.ready")}
        />
        <span className="text-sm">{t("settings.print3d.ready")}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{t("settings.print3d.readyHint")}</p>
      <p className="mt-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs">
        {t("settings.print3d.waNote")}
      </p>
      <ErrorBox error={save.error} />
    </Card>
  );
}
