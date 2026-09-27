import { useEffect, useState } from "react";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { crmFn, saveCrmFn, testCrmFn } from "@/app/admin/crm.functions";
import { adminT } from "@/app/i18n/admin";
import { settingsRoute } from "./route";

/** Интеграция с CRM и Таблицами: события заказа POST-запросом на адрес продавца. */
export function CrmCard() {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const [d, setD] = useState<Awaited<ReturnType<typeof crmFn>> | null>(null);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void crmFn().then((r) => {
      setD(r);
      setUrl(r.url);
      setEvents(r.events);
    });
  }, []);
  const owner = shop.role === "owner";
  const save = useAction(async () => {
    await saveCrmFn({ data: { url, secret: secret ? secret : null, events } });
    setSecret("");
    setNote(t("settings.saved"));
  });
  const test = useAction(async () => {
    const r = await testCrmFn();
    setNote(r.ok ? t("settings.crm.testOk") : t("settings.crm.testFail", { error: r.error }));
  });
  if (!d) return null;
  return (
    <Card title={t("settings.crm.title")} className="lg:col-span-2">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setNote(null);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("settings.crm.intro")}</p>
        <Field label={t("settings.crm.url")} hint={t("settings.crm.urlHint")}>
          <input
            className="input"
            value={url}
            disabled={!owner}
            placeholder="https://script.google.com/macros/s/…/exec"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field
          label={t("settings.crm.secret")}
          hint={d.hasSecret ? t("settings.crm.secretSet") : t("settings.crm.secretHint")}
        >
          <input
            className="input"
            type="password"
            value={secret}
            disabled={!owner}
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
        <Field label={t("settings.crm.events")}>
          <div className="grid gap-1 sm:grid-cols-3">
            {d.all.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!owner}
                  checked={events.includes(ev)}
                  onChange={(e) =>
                    setEvents((x) => (e.target.checked ? [...x, ev] : x.filter((y) => y !== ev)))
                  }
                />
                {t(`settings.crm.event.${ev}` as never)}
              </label>
            ))}
          </div>
        </Field>
        {owner && (
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={test.busy || !d.url}
              onClick={() => {
                setNote(null);
                void test.run().catch(() => {});
              }}
            >
              {t("settings.crm.test")}
            </button>
            {note && <span className="text-sm text-muted">{note}</span>}
          </div>
        )}
        <ErrorBox error={save.error ?? test.error} />
      </form>
    </Card>
  );
}
