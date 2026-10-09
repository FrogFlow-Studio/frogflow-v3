import { useRouter, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { saveConsultantFn } from "@/app/admin/consultant-settings.functions";
import { Card, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { PAUSE_CHOICES, type PauseHours } from "@/core/consultant/pause";
import { PersonaCard, SettingsCard } from "@/app/admin/pricelist-cards";
import { WorkspaceTestChat } from "@/app/admin/workspace-test-chat";
import { canEdit } from "@/core/auth/roles";
import { StoriesCard } from "./stories";

/** Данные и контекст страницы консультанта: компонент вынесен из файла маршрута. */
const Route = getRouteApi("/admin/_authed/consultant");

/** Настройки рабочего места консультанта. */

/**
 * «Настройки бота» рабочего места консультанта без продаж (BOVI): работа
 * (вкл/выкл и пауза после ответа менеджера), часы и бутик, образ, товары в
 * публикациях, пробный диалог с историей. Записи — те же, что на обычных
 * страницах консультанта и прайса (saveConsultantFn, savePricelistSettingsFn,
 * savePricelistPersonaFn).
 */
export function WorkspaceSettings() {
  const data = Route.useLoaderData();
  const pl = data.pl!;
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const router = useRouter();
  const editable = canEdit(shop.role);
  const [enabled, setEnabled] = useState(data.enabled);
  const [pause, setPause] = useState<PauseHours>(data.pauseHours);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    // Образ и документы у консультанта по прайсу не читаются: уходят как были.
    await saveConsultantFn({
      data: { enabled, pauseHours: pause, profile: data.profile, docs: data.docs },
    });
    setSaved(true);
    await router.invalidate();
  });
  return (
    <>
      <PageTitle title={t("ws.settings.title")} subtitle={t("ws.settings.subtitle")} />
      {!data.configured && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t("consultant.notConfigured")}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] [&>*]:min-w-0">
        <div className="space-y-4">
          <Card title={t("ws.settings.work")}>
            <div className="mb-4 flex items-center gap-3">
              <Switch
                checked={enabled}
                onChange={setEnabled}
                disabled={!editable}
                label={t("consultant.enable")}
              />
              <span className="text-sm">
                {enabled ? t("consultant.enabledHint") : t("consultant.disabledHint")}
              </span>
            </div>
            <Field label={t("consultant.pause")} hint={t("consultant.pauseHint")}>
              <select
                className="input mb-4 w-auto"
                value={pause}
                disabled={!editable}
                onChange={(e) => setPause(Number(e.target.value) as PauseHours)}
              >
                {PAUSE_CHOICES.map((h) => (
                  <option key={h} value={h}>
                    {t(`consultant.pause.h${h}` as AdminKey)}
                  </option>
                ))}
              </select>
            </Field>
            {editable && (
              <div className="flex items-center gap-3">
                <button
                  className="btn-primary"
                  disabled={save.busy}
                  onClick={() => void save.run().catch(() => {})}
                >
                  {save.busy ? t("consultant.saving") : t("common.save")}
                </button>
                {saved && <span className="text-sm text-ok">{t("consultant.saved")}</span>}
              </div>
            )}
            <ErrorBox error={save.error} />
          </Card>
          <SettingsCard t={t} data={pl} canEdit={editable} onDone={router.invalidate} />
          <PersonaCard t={t} data={pl} canEdit={editable} onDone={router.invalidate} />
        </div>
        <div className="space-y-4">
          <WorkspaceTestChat configured={data.configured} t={t} />
          {shop.modules.instagram && <StoriesCard t={t} />}
          <Card title={t("pricelist.usage.title")}>
            <p className="text-sm">
              {pl.usage.messages
                ? t("pricelist.usage.summary", {
                    messages: pl.usage.messages,
                    usd: pl.usage.usd.toFixed(2),
                    per: pl.usage.usdPerMessage.toFixed(4),
                    share: Math.round(pl.usage.cacheReadShare * 100),
                  })
                : t("pricelist.usage.empty")}
            </p>
            {data.lastError && (
              <p className="mt-3 text-xs text-danger">
                {t("consultant.usage.lastError", { error: data.lastError })}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              {t("consultant.usage.tokens")}: {data.usage.inputTokens.toLocaleString(loc)} /{" "}
              {data.usage.outputTokens.toLocaleString(loc)}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
