import { useEffect, useState } from "react";
import { wizardCheckFn, wizardStartFn, wizardStateFn } from "@/app/admin/connections.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import { adminT, type AdminKey } from "@/app/i18n/admin";
import { settingsRoute } from "./route";
import { roleAllows } from "@/core/auth/roles";

type State = Awaited<ReturnType<typeof wizardCheckFn>>;
type Platform = State["platform"];

const CHANNEL_LABEL: Record<Platform, string> = { instagram: "Instagram", whatsapp: "WhatsApp" };
const STEPS = ["login", "webhook", "test"] as const;

/**
 * Мастер подключения канала: «войдите → проверка связи → тестовое сообщение».
 * Шаг и причина сбоя приходят с сервера (channels/zernio/wizard); карточка
 * только показывает их и зовёт «Войти» и «Проверить».
 */
function WizardPanel({
  platform,
  initial,
  returned,
}: {
  platform: Platform;
  initial: State | null;
  returned: boolean;
}) {
  const { shop } = settingsRoute.useRouteContext();
  const t = adminT(shop.locale);
  const channel = CHANNEL_LABEL[platform];
  const owner = roleAllows(shop.role, "admin");
  const [state, setState] = useState<State | null>(initial);
  const check = useAction(async () => {
    setState(await wizardCheckFn({ data: { platform } }));
  });
  const start = useAction(async () => {
    const r = await wizardStartFn({ data: { platform } });
    setState(r.state);
    if (r.url) window.location.assign(r.url);
  });
  // Вернулись со страницы входа Zernio: сразу проверить, что вход прошёл.
  useEffect(() => {
    if (returned && initial) void check.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const step = state?.step ?? "login";
  const stepNo = step === "done" ? STEPS.length : STEPS.indexOf(step);
  const busy = check.busy || start.busy;
  return (
    <div className="mb-4 rounded-md border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-medium">{t("wizard.title", { channel })}</h3>
        {step === "done" && <Badge tone="ok">{t("wizard.step.done")}</Badge>}
      </div>
      {!state && <p className="mb-2 text-sm text-muted">{t("wizard.intro")}</p>}
      {state && (
        <ol className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {STEPS.map((s) => (
            <li
              key={s}
              className={
                s === step ? "font-medium" : STEPS.indexOf(s) < stepNo ? "text-ok" : "text-muted"
              }
            >
              {t(`wizard.step.${s}` as AdminKey)}
            </li>
          ))}
        </ol>
      )}
      <p className="text-sm text-muted">{t(`wizard.hint.${step}` as AdminKey, { channel })}</p>
      {state?.problem && (
        <p className="mt-2 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t(`wizard.problem.${state.problem}` as AdminKey)}
        </p>
      )}
      {owner ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {step === "login" && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void start.run().catch(() => {})}
            >
              {t("wizard.start", { channel })}
            </button>
          )}
          {state?.started && step !== "done" && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void check.run().catch(() => {})}
            >
              {t("wizard.check")}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">{t("wizard.ownerOnly")}</p>
      )}
      <ErrorBox error={start.error ?? check.error} />
    </div>
  );
}

export function ChannelWizardCards({
  instagram,
  whatsapp,
}: {
  instagram: boolean;
  whatsapp: boolean;
}) {
  const [entries, setEntries] = useState<State[] | null>(null);
  const [returned, setReturned] = useState(false);
  useEffect(() => {
    setReturned(window.location.search.includes("zernio=connected"));
    void wizardStateFn().then((r) => setEntries(r.entries as State[]));
  }, []);
  if (!entries) return null;
  const of = (p: Platform) => entries.find((e) => e.platform === p) ?? null;
  return (
    <Card title="" className="lg:col-span-2">
      {instagram && (
        <WizardPanel platform="instagram" initial={of("instagram")} returned={returned} />
      )}
      {whatsapp && <WizardPanel platform="whatsapp" initial={of("whatsapp")} returned={returned} />}
    </Card>
  );
}
