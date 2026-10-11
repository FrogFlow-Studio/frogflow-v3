import { Link, useRouter, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { saveConsultantFn } from "@/app/admin/consultant-settings.functions";
import { Card, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { GOALS, TONES, type ConsultantProfile } from "@/core/consultant/profile";
import type { KnowledgeDoc } from "@/core/consultant/knowledge";
import { PAUSE_CHOICES, type PauseHours } from "@/core/consultant/pause";
import { TestChat } from "./test-chat";
import { StoriesCard } from "./stories";
import { HelpTip } from "@/app/admin/help-panel";

/** Данные и контекст страницы консультанта: компонент вынесен из файла маршрута. */
const Route = getRouteApi("/admin/_authed/consultant");

/** Классическая страница консультанта. */

export function ConsultantClassic() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const router = useRouter();
  const [enabled, setEnabled] = useState(data.enabled);
  const [profile, setProfile] = useState<ConsultantProfile>(data.profile);
  const [docs, setDocs] = useState<KnowledgeDoc[]>(data.docs);
  const [pause, setPause] = useState<PauseHours>(data.pauseHours);
  const [saved, setSaved] = useState(false);
  const save = useAction(async () => {
    setSaved(false);
    await saveConsultantFn({
      data: {
        enabled,
        pauseHours: pause,
        profile,
        docs: docs
          .filter((d) => d.title.trim() && d.content.trim())
          .map((d) => ({
            id: d.id,
            title: d.title.trim(),
            category: d.category?.trim() || undefined,
            content: d.content.trim(),
          })),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const set = <K extends keyof ConsultantProfile>(k: K, v: ConsultantProfile[K]) =>
    setProfile((p) => ({ ...p, [k]: v }));
  const setDoc = (i: number, patch: Partial<KnowledgeDoc>) =>
    setDocs((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <>
      <PageTitle title={t("consultant.title")} subtitle={t("consultant.subtitle")} />
      {!data.configured && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t("consultant.notConfigured")}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-4">
          <Card
            title={t("consultant.profile.title")}
            help={<HelpTip article="consultant" anchor="profile" />}
          >
            <div className="mb-4 flex items-center gap-3">
              <Switch checked={enabled} onChange={setEnabled} label={t("consultant.enable")} />
              <span className="text-sm">
                {enabled ? t("consultant.enabledHint") : t("consultant.disabledHint")}
              </span>
              <HelpTip article="consultant" anchor="enable" />
            </div>
            <Field
              label={t("consultant.pause")}
              hint={t("consultant.pauseHint")}
              help={<HelpTip article="consultant" anchor="pause" />}
            >
              <select
                className="input mb-4 w-auto"
                value={pause}
                onChange={(e) => setPause(Number(e.target.value) as PauseHours)}
              >
                {PAUSE_CHOICES.map((h) => (
                  <option key={h} value={h}>
                    {t(`consultant.pause.h${h}` as AdminKey)}
                  </option>
                ))}
              </select>
            </Field>
            {/* По прайсу эти поля не читаются: образ, сайт и часы — на странице прайса. */}
            {data.pricelist.on ? (
              <>
                <p className="text-sm">{t("consultant.profile.pricelist")}</p>
                <p className="mt-2 text-sm">
                  {t("consultant.knowledge.pricelist", { n: String(data.pricelist.articles) })}
                </p>
                <Link to="/admin/pricelist" className="btn-secondary mt-3 inline-block text-sm">
                  {t("consultant.knowledge.openPricelist")}
                </Link>
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("consultant.brandName")}>
                    <input
                      className="input"
                      value={profile.brand_name}
                      onChange={(e) => set("brand_name", e.target.value)}
                    />
                  </Field>
                  <Field label={t("consultant.website")} hint={t("consultant.optional")}>
                    <input
                      className="input"
                      value={profile.website_url ?? ""}
                      onChange={(e) => set("website_url", e.target.value || undefined)}
                      placeholder="https://"
                    />
                  </Field>
                  <Field
                    label={t("consultant.goal")}
                    help={<HelpTip article="consultant" anchor="goal" />}
                  >
                    <select
                      className="input"
                      value={profile.goal}
                      onChange={(e) => set("goal", e.target.value as ConsultantProfile["goal"])}
                    >
                      {GOALS.map((g) => (
                        <option key={g} value={g}>
                          {t(`consultant.goal.${g}` as AdminKey)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={t("consultant.tone")}
                    help={<HelpTip article="consultant" anchor="goal" />}
                  >
                    <select
                      className="input"
                      value={profile.tone}
                      onChange={(e) => set("tone", e.target.value as ConsultantProfile["tone"])}
                    >
                      {TONES.map((tone) => (
                        <option key={tone} value={tone}>
                          {t(`consultant.tone.${tone}` as AdminKey)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={t("consultant.language")}
                    hint={t("consultant.languageHint")}
                    help={<HelpTip article="consultant" anchor="goal" />}
                  >
                    <select
                      className="input"
                      value={profile.primary_language}
                      onChange={(e) =>
                        set(
                          "primary_language",
                          e.target.value as ConsultantProfile["primary_language"],
                        )
                      }
                    >
                      <option value="ru">Русский</option>
                      <option value="kk">Қазақша</option>
                      <option value="en">English</option>
                    </select>
                  </Field>
                  <Field label={t("consultant.currency")}>
                    <input
                      className="input"
                      value={profile.currency}
                      maxLength={3}
                      onChange={(e) => set("currency", e.target.value.toUpperCase())}
                    />
                  </Field>
                  <Field label={t("consultant.countries")} hint={t("consultant.countriesHint")}>
                    <input
                      className="input"
                      value={profile.countries.join(", ")}
                      onChange={(e) =>
                        set(
                          "countries",
                          e.target.value
                            .split(",")
                            .map((c) => c.trim().toUpperCase())
                            .filter(Boolean),
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="mt-3 space-y-3">
                  <Field label={t("consultant.about")} hint={t("consultant.aboutHint")}>
                    <textarea
                      className="input min-h-20"
                      value={profile.about ?? ""}
                      onChange={(e) => set("about", e.target.value || undefined)}
                    />
                  </Field>
                  <Field label={t("consultant.delivery")}>
                    <textarea
                      className="input min-h-16"
                      value={profile.delivery_info ?? ""}
                      onChange={(e) => set("delivery_info", e.target.value || undefined)}
                      placeholder={t("consultant.deliveryPlaceholder")}
                    />
                  </Field>
                  <Field label={t("consultant.payment")}>
                    <textarea
                      className="input min-h-16"
                      value={profile.payment_info ?? ""}
                      onChange={(e) => set("payment_info", e.target.value || undefined)}
                      placeholder={t("consultant.paymentPlaceholder")}
                    />
                  </Field>
                  <Field
                    label={t("consultant.instructions")}
                    help={<HelpTip article="consultant" anchor="instructions" />}
                    hint={t("consultant.instructionsHint")}
                  >
                    <textarea
                      className="input min-h-20"
                      value={profile.custom_instructions ?? ""}
                      onChange={(e) => set("custom_instructions", e.target.value || undefined)}
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(profile.medical_disclaimer)}
                      onChange={(e) => set("medical_disclaimer", e.target.checked)}
                    />
                    {t("consultant.medicalDisclaimer")}
                    <HelpTip article="consultant" anchor="disclaimer" />
                  </label>
                </div>
              </>
            )}
          </Card>

          {/* По прайсу база знаний — на странице прайса: ссылка на неё в карточке выше. */}
          {data.pricelist.on ? null : (
            <>
              {(data.pricelist.articles > 0 || data.pricelist.hasCatalog) && (
                <div className="rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
                  {t("consultant.knowledge.pricelistOff", {
                    n: String(data.pricelist.articles),
                  })}
                </div>
              )}
              <Card
                title={t("consultant.knowledge.title")}
                help={<HelpTip article="consultant" anchor="knowledge" />}
                actions={
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() =>
                      setDocs((ds) => [...ds, { id: `doc${Date.now()}`, title: "", content: "" }])
                    }
                  >
                    {t("consultant.knowledge.add")}
                  </button>
                }
              >
                <p className="mb-3 text-sm text-muted">{t("consultant.knowledge.intro")}</p>
                {docs.length === 0 && (
                  <p className="text-sm text-muted">{t("consultant.knowledge.empty")}</p>
                )}
                <div className="space-y-4">
                  {docs.map((d, i) => (
                    <div key={d.id} className="rounded-md border border-line p-3">
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                        <input
                          className="input"
                          placeholder={t("consultant.knowledge.docTitle")}
                          value={d.title}
                          onChange={(e) => setDoc(i, { title: e.target.value })}
                        />
                        <input
                          className="input sm:w-40"
                          placeholder={t("consultant.knowledge.category")}
                          value={d.category ?? ""}
                          onChange={(e) => setDoc(i, { category: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btn-ghost text-xs text-danger"
                          onClick={() => setDocs((ds) => ds.filter((_, j) => j !== i))}
                        >
                          {t("common.delete")}
                        </button>
                      </div>
                      <textarea
                        className="input mt-2 min-h-24"
                        placeholder={t("consultant.knowledge.content")}
                        value={d.content}
                        onChange={(e) => setDoc(i, { content: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}

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
          <ErrorBox error={save.error} />
        </div>

        <div className="min-w-0 space-y-4">
          <TestChat configured={data.configured} t={t} />
          {shop.modules.instagram && <StoriesCard t={t} />}
          <Card
            title={t("consultant.usage.title")}
            help={<HelpTip article="consultant" anchor="usage" />}
          >
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">{t("consultant.usage.count")}</dt>
              <dd className="tabular-nums">{data.usage.count}</dd>
              <dt className="text-muted">{t("consultant.usage.cost")}</dt>
              <dd className="tabular-nums">${data.usage.usd.toFixed(4)}</dd>
              <dt className="text-muted">{t("consultant.usage.tokens")}</dt>
              <dd className="tabular-nums">
                {data.usage.inputTokens.toLocaleString(loc)} /{" "}
                {data.usage.outputTokens.toLocaleString(loc)}
              </dd>
            </dl>
            {data.lastError && (
              <p className="mt-3 text-xs text-danger">
                {t("consultant.usage.lastError", { error: data.lastError })}
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
