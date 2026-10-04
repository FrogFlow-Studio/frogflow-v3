import { useEffect, useState } from "react";
import { Card, ErrorBox, Field, useAction } from "@/app/ui";
import { crmFn, crmLogFn, saveCrmFn, testCrmFn } from "@/app/admin/crm.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
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
  const [log, setLog] = useState<Awaited<ReturnType<typeof crmLogFn>>["entries"] | null>(null);
  const loadLog = () =>
    void crmLogFn().then(
      (r) => setLog(r.entries),
      () => setLog(null),
    );
  useEffect(() => {
    void crmFn().then((r) => {
      setD(r);
      setUrl(r.url);
      setEvents(r.events);
    });
    loadLog();
  }, []);
  const owner = shop.role === "owner";
  const save = useAction(async () => {
    await saveCrmFn({ data: { url, secret: secret ? secret : null, events } });
    setSecret("");
    setNote(t("settings.saved"));
  });
  const test = useAction(async () => {
    const r = await testCrmFn();
    loadLog();
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
      {log && <DeliveryLog entries={log} t={t} locale={shop.locale} />}
    </Card>
  );
}

type LogEntries = NonNullable<Awaited<ReturnType<typeof crmLogFn>>["entries"]>;

/** Журнал доставки: последние отправки вебхука без тела и секрета. */
function DeliveryLog({
  entries,
  t,
  locale,
}: {
  entries: LogEntries;
  t: AdminT;
  locale: Parameters<typeof intlLocale>[0];
}) {
  const result = (e: LogEntries[number]) =>
    t(`crmlog.${e.outcome}` as never, { status: e.status ?? "" });
  const eventName = (ev: string) =>
    ev === "ping"
      ? t("crmlog.event.ping")
      : t(`settings.crm.event.${ev.replace("order.", "")}` as never);
  return (
    <div className="mt-6 space-y-2" data-testid="crm-log">
      <h3 className="font-medium">{t("crmlog.title")}</h3>
      <p className="text-sm text-muted">{t("crmlog.hint")}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">{t("crmlog.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="pr-3">{t("crmlog.col.when")}</th>
                <th className="pr-3">{t("crmlog.col.event")}</th>
                <th className="pr-3">{t("crmlog.col.order")}</th>
                <th>{t("crmlog.col.result")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <td className="pr-3 whitespace-nowrap">
                    {new Date(e.at).toLocaleString(intlLocale(locale))}
                  </td>
                  <td className="pr-3">{eventName(e.event)}</td>
                  <td className="pr-3">{e.orderId ? `#${e.orderId}` : "—"}</td>
                  <td className={e.outcome === "ok" ? "" : "text-red-600"}>{result(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
