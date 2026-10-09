import { useState } from "react";
import { savePricelistPersonaFn } from "../pricelist.functions";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { type CardProps } from "./shared";

/** Характер консультанта. */

/** Образ консультанта: название, о магазине, тон, особенности товаров. */
export function PersonaCard({ t, data, canEdit, onDone }: CardProps) {
  const [persona, setPersona] = useState(data.persona);
  const [custom, setCustom] = useState(data.personaCustom);
  const [saved, setSaved] = useState(false);
  const lim = data.personaLimits;
  const save = useAction(async (next: typeof persona | null) => {
    setSaved(false);
    const r = await savePricelistPersonaFn({ data: { persona: next } });
    setCustom(r.custom);
    setSaved(true);
    await onDone();
  });
  const set = (k: keyof typeof persona, v: string) => setPersona((p) => ({ ...p, [k]: v }));
  const left = (k: keyof typeof persona) => lim[k] - persona[k].length;
  return (
    <Card title={t("pricelist.persona.title")}>
      <p className="mb-3 text-sm text-muted">{t("pricelist.persona.hint")}</p>
      <div className="space-y-3">
        <Field label={t("pricelist.persona.brand")}>
          <input
            className="input"
            value={persona.brand}
            maxLength={lim.brand}
            disabled={!canEdit}
            onChange={(e) => set("brand", e.target.value)}
          />
        </Field>
        <Field label={t("pricelist.persona.about")} hint={t("pricelist.persona.aboutHint")}>
          <textarea
            className="input min-h-16 text-sm"
            value={persona.about}
            maxLength={lim.about}
            disabled={!canEdit}
            onChange={(e) => set("about", e.target.value)}
          />
        </Field>
        <Field label={t("pricelist.persona.tone")} hint={t("pricelist.persona.toneHint")}>
          <textarea
            className="input min-h-16 text-sm"
            value={persona.tone}
            maxLength={lim.tone}
            disabled={!canEdit}
            onChange={(e) => set("tone", e.target.value)}
          />
        </Field>
        <Field
          label={t("pricelist.persona.specialities")}
          hint={t("pricelist.persona.specialitiesHint")}
        >
          <textarea
            className="input min-h-32 text-sm"
            value={persona.specialities}
            maxLength={lim.specialities}
            disabled={!canEdit}
            onChange={(e) => set("specialities", e.target.value)}
          />
        </Field>
        <p className="text-xs text-muted">
          {t("pricelist.persona.left", { left: left("specialities") })}
        </p>
        <p className="text-sm text-muted">
          {custom ? t("pricelist.persona.custom") : t("pricelist.persona.default")}
        </p>
        {canEdit && (
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={save.busy || !persona.brand.trim()}
              onClick={() => void save.run(persona).catch(() => {})}
            >
              {t("pricelist.save")}
            </button>
            {custom && (
              <button
                className="btn-secondary"
                disabled={save.busy}
                onClick={() => void save.run(null).catch(() => {})}
              >
                {t("pricelist.persona.reset")}
              </button>
            )}
            {saved && <span className="text-sm text-ok">{t("pricelist.saved")}</span>}
          </div>
        )}
        <ErrorBox error={save.error} />
      </div>
    </Card>
  );
}
