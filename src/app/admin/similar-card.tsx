import { useEffect, useState } from "react";
import { saveSimilarFn, similarFn } from "@/app/admin/winback.functions";
import type { AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox, Field, Switch, useAction } from "@/app/ui";

/** «Похожие материалы»: через N дней после покупки — товары из тех же категорий. */
export function SimilarCard({ t }: { t: AdminT }) {
  const [c, setC] = useState<Awaited<ReturnType<typeof similarFn>> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void similarFn().then(setC);
  }, []);
  const save = useAction(async () => {
    if (!c) return;
    await saveSimilarFn({ data: c });
    setSaved(true);
  });
  if (!c) return null;
  return (
    <Card
      title={t("similar.title")}
      actions={
        <Switch
          checked={c.enabled}
          onChange={(on) => setC({ ...c, enabled: on })}
          label={t("similar.enabled")}
        />
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("similar.intro")}</p>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label={t("similar.days")}>
            <input
              className="input"
              type="number"
              min={1}
              max={60}
              value={c.days}
              onChange={(e) => setC({ ...c, days: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("similar.text")} hint={t("similar.textHint")}>
            <textarea
              className="input min-h-16"
              value={c.text}
              onChange={(e) => setC({ ...c, text: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">✓</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
