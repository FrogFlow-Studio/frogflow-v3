/** Карточка клиента у оператора: тариф, пробный период, лимиты ИИ и счёт по плану. */
import { useEffect, useState, type FormEvent } from "react";
import {
  planFn,
  setPlanFn,
  planActionFn,
  extendTrialFn,
  setAiQuotaFn,
  planInvoicePreviewFn,
  createPlanInvoiceFn,
} from "@/app/operator/operator.functions";
import {
  ADDONS,
  ADDON_MONTHLY_PRICE,
  ADDON_KEYS,
  CONNECTION_PRICE,
  MONTHLY_PRICE,
  PLAN_TIERS,
  TIER_TITLES,
  TRIAL_DAYS,
  TRIAL_EXTEND_MAX_DAYS,
  parsePlan,
  type AddonKey,
  type PlanTier,
} from "@/core/plans/registry";
import { moduleDef } from "@/core/modules/registry";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import type { C } from "./types";

type PlanView = Awaited<ReturnType<typeof planFn>>;

const fmt = (n: number) => `${n.toLocaleString("ru")} ₸`;

/**
 * Тариф клиента: план ниши (Basic/Pro/Business) или индивидуальные условия,
 * надбавки каналов, пробный период, подбор плана действующему клиенту,
 * лимиты ИИ и счёт по плану. Модули ниже пересчитываются по плану сами.
 */
export function PlanCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const [v, setV] = useState<PlanView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useAction(async () => setV(await planFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, c.plan]);
  const parsed = parsePlan(c.plan);
  const [tier, setTier] = useState<PlanTier | "custom">(
    parsed?.kind === "tier" ? parsed.tier : parsed?.kind === "custom" ? "custom" : "basic",
  );
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [addons, setAddons] = useState<AddonKey[]>([]);
  const [prices, setPrices] = useState<Partial<Record<AddonKey, number>>>({});
  useEffect(() => {
    if (!v) return;
    setPeriod(v.billing.period ?? "month");
    setAddons(v.billing.addons ?? []);
    // У ниши без тарифов (консультант BOVI) в списке только «Индивидуальный»:
    // без этого список показывал его, а сохранялся невидимый «basic» (06.10).
    if (!v.niche) setTier("custom");
  }, [v]);
  const save = useAction(async () => {
    if (
      !confirm(
        tier === "custom"
          ? "Перевести на индивидуальные условия? Модули останутся как есть."
          : "Сменить план? Модули клиента пересчитаются: всё, что не входит в план, надбавки и сохранённое, выключится.",
      )
    )
      return;
    await setPlanFn({ data: { botId: c.id, tier, period, addons } });
    setNote("План сохранён, модули пересчитаны.");
    await onDone();
    await load.run();
  });
  const action = useAction(async (a: "adopt" | "trial") => {
    const r = await planActionFn({ data: { botId: c.id, action: a } });
    setNote(r.message);
    await onDone();
    await load.run();
  });
  const extend = useAction(async (f: FormData) => {
    const r = await extendTrialFn({ data: { botId: c.id, days: Number(f.get("days")) } });
    setNote(r.message);
    await onDone();
    await load.run();
  });
  const quota = useAction(async (f: FormData) => {
    const val = (k: string) => {
      const x = String(f.get(k) ?? "").trim();
      return x === "" ? undefined : x === "-" ? null : Number(x);
    };
    await setAiQuotaFn({
      data: { botId: c.id, ai_dialogs: val("ai_dialogs"), receipt_checks: val("receipt_checks") },
    });
    setNote("Лимиты сохранены.");
    await load.run();
  });
  const [shown, setShown] = useState<Awaited<ReturnType<typeof planInvoicePreviewFn>> | null>(null);
  const preview = useAction(async () =>
    setShown(await planInvoicePreviewFn({ data: { botId: c.id, period, addonPrices: prices } })),
  );
  const invoice = useAction(async () => {
    const r = await createPlanInvoiceFn({ data: { botId: c.id, period, addonPrices: prices } });
    setNote(
      r.delivered
        ? `Счёт на ${fmt(r.invoice.amount)} выставлен и отправлен владельцу.`
        : `Счёт на ${fmt(r.invoice.amount)} выставлен, но не доставлен: ${r.deliveryError ?? "владелец не получил сообщение"}.`,
    );
    setShown(null);
    await load.run();
  });
  const onTier = parsed?.kind === "tier";
  const limitText = (used: number, limit: number | null | undefined) =>
    limit === undefined
      ? `${used}`
      : limit === null
        ? `${used} · без лимита`
        : `${used} из ${limit}`;
  return (
    <Card
      title="Тариф"
      actions={
        <Badge tone={parsed ? "accent" : "neutral"}>
          {parsed?.kind === "tier"
            ? TIER_TITLES[parsed.tier]
            : parsed?.kind === "custom"
              ? "по договору"
              : "без плана"}
        </Badge>
      }
    >
      {!v ? (
        <p className="text-sm text-muted">Загрузка…</p>
      ) : (
        <div className="space-y-4 text-sm">
          {v.writeBlock && <p className="text-warn">{v.writeBlock}</p>}
          {!v.niche && (
            <p className="text-muted">
              У этой ниши нет тарифов (консультант BOVI — по договору). Выберите «Индивидуальный»,
              модули включаются вручную.
            </p>
          )}
          {v.suggestion && (
            <div className="rounded-md border border-line p-3">
              <div className="font-medium">
                Подходит план {TIER_TITLES[v.suggestion.tier]}
                {v.suggestion.grandfathered.length > 0 &&
                  ` + бесплатно сохранить: ${v.suggestion.grandfathered.map((k) => moduleDef(k).title).join(", ")}`}
              </div>
              <p className="mt-1 text-xs text-muted">
                Для действующего клиента: купленное остаётся бесплатно, подключение не берётся, срок
                подписки не меняется.
              </p>
              <button
                className="btn-secondary mt-2 text-xs"
                disabled={action.busy}
                onClick={() => void action.run("adopt").catch(() => {})}
              >
                Перевести на подобранный план
              </button>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="План">
              <select
                className="input"
                value={tier}
                onChange={(e) => setTier(e.target.value as PlanTier | "custom")}
              >
                {v.niche &&
                  PLAN_TIERS.map((t) => (
                    <option key={t} value={t}>
                      {TIER_TITLES[t]} · {fmt(MONTHLY_PRICE[t])}/мес, подключение{" "}
                      {fmt(CONNECTION_PRICE[t])}
                    </option>
                  ))}
                <option value="custom">Индивидуальный (по договору)</option>
              </select>
            </Field>
            <Field label="Оплата">
              <select
                className="input"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value as "month" | "year");
                  setShown(null);
                }}
              >
                <option value="month">помесячно</option>
                <option value="year">за год (12 мес. по цене 10)</option>
              </select>
            </Field>
          </div>
          {tier !== "custom" && (
            <div className="flex flex-wrap gap-4">
              {ADDON_KEYS.map((a) => (
                <label key={a} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={addons.includes(a)}
                    onChange={(e) =>
                      setAddons((xs) => (e.target.checked ? [...xs, a] : xs.filter((x) => x !== a)))
                    }
                  />
                  {ADDONS[a].title} сверх плана
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              disabled={save.busy}
              onClick={() => void save.run().catch(() => {})}
            >
              Сохранить план
            </button>
            {v.niche && !v.billing.trial_until && (
              <button
                className="btn-secondary"
                disabled={action.busy}
                onClick={() => void action.run("trial").catch(() => {})}
              >
                Пробный период {TRIAL_DAYS} дней
              </button>
            )}
          </div>
          {v.billing.trial_until && (
            <form
              className="flex flex-wrap items-center gap-2 text-xs text-muted"
              onSubmit={(e) => {
                e.preventDefault();
                void extend.run(new FormData(e.currentTarget)).catch(() => {});
              }}
            >
              <span>
                Пробный период до {new Date(v.billing.trial_until).toLocaleDateString("ru")}.
                Продлить на
              </span>
              <input
                name="days"
                type="number"
                min={1}
                max={TRIAL_EXTEND_MAX_DAYS}
                defaultValue={7}
                className="input w-16 py-1"
              />
              <span>дн.</span>
              <button className="btn-secondary py-1" disabled={extend.busy}>
                Продлить
              </button>
            </form>
          )}
          {v.outsidePlan.length > 0 && (
            <p className="text-xs text-warn">
              Включены вне плана: {v.outsidePlan.map((k) => moduleDef(k).title).join(", ")}.
              Сохраните план, чтобы пересчитать модули.
            </p>
          )}
          {onTier && (
            <>
              <div className="border-t border-line pt-3">
                <div className="font-medium">ИИ за {v.usage.month}</div>
                <div className="text-muted">
                  Диалоги консультанта: {limitText(v.usage.aiDialogs, v.usage.limits?.aiDialogs)}
                  <br />
                  Проверки чеков: {limitText(v.usage.receiptChecks, v.usage.limits?.receiptChecks)}
                </div>
                {v.upgrade && (
                  <p className="mt-1 text-warn">
                    {v.upgrade.level === "over" ? "Лимит исчерпан" : "Лимит почти израсходован"} (
                    {v.upgrade.what
                      .map((w) => (w === "aiDialogs" ? "диалоги" : "проверки чеков"))
                      .join(", ")}
                    ).{" "}
                    {v.upgrade.next
                      ? `Предложите клиенту план ${TIER_TITLES[v.upgrade.next]}.`
                      : "Это старший план: договоритесь о своём лимите."}
                  </p>
                )}
                <form
                  className="mt-2 grid gap-2 sm:grid-cols-3"
                  onSubmit={(e: FormEvent<HTMLFormElement>) => {
                    e.preventDefault();
                    void quota.run(new FormData(e.currentTarget)).catch(() => {});
                  }}
                >
                  <input
                    className="input"
                    name="ai_dialogs"
                    placeholder="диалогов: как в плане"
                    defaultValue={v.billing.ai_quota?.ai_dialogs ?? ""}
                  />
                  <input
                    className="input"
                    name="receipt_checks"
                    placeholder="чеков: как в плане"
                    defaultValue={
                      v.billing.ai_quota?.receipt_checks === null
                        ? "-"
                        : (v.billing.ai_quota?.receipt_checks ?? "")
                    }
                  />
                  <button className="btn-secondary" disabled={quota.busy}>
                    Свой лимит
                  </button>
                  <p className="text-xs text-muted sm:col-span-3">
                    Пусто — как в плане, «-» — без лимита. Сверх лимита новые диалоги уходят
                    менеджеру, чеки — на ручную проверку.
                  </p>
                </form>
              </div>
              <div className="border-t border-line pt-3">
                <div className="font-medium">Счёт по плану</div>
                {(v.billing.addons ?? []).map((a) => (
                  <label key={a} className="mt-1 flex items-center gap-2">
                    <span className="w-40 text-muted">{ADDONS[a].title}, ₸ в месяц</span>
                    <input
                      className="input w-32"
                      type="number"
                      min={0}
                      placeholder={`${ADDON_MONTHLY_PRICE[a]} по тарифу`}
                      value={prices[a] ?? ""}
                      onChange={(e) => {
                        // Пустое поле — цена по тарифу (ADDON_MONTHLY_PRICE), а не 0 ₸.
                        const x = e.target.value.trim();
                        setPrices((p) => ({ ...p, [a]: x === "" ? undefined : Number(x) }));
                      }}
                    />
                  </label>
                ))}
                {shown && (
                  <ul className="mt-2 text-muted">
                    {shown.lines.map((l) => (
                      <li key={l.title} className="flex justify-between">
                        <span>{l.title}</span>
                        <span className="tabular-nums">{fmt(l.amount)}</span>
                      </li>
                    ))}
                    <li className="flex justify-between font-medium text-fg">
                      <span>Итого</span>
                      <span className="tabular-nums">{fmt(shown.amount)}</span>
                    </li>
                  </ul>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    className="btn-secondary text-xs"
                    disabled={preview.busy}
                    onClick={() => void preview.run().catch(() => {})}
                  >
                    Посчитать
                  </button>
                  {shown && (
                    <button
                      className="btn-primary text-xs"
                      disabled={invoice.busy}
                      onClick={() => void invoice.run().catch(() => {})}
                    >
                      Выставить на {fmt(shown.amount)}
                    </button>
                  )}
                </div>
                {!v.billing.connection_paid_at && (
                  <p className="mt-1 text-xs text-muted">
                    Подключение ещё не оплачено — входит в счёт.
                  </p>
                )}
              </div>
            </>
          )}
          {note && <p className="text-muted">{note}</p>}
          <ErrorBox
            error={
              load.error ??
              save.error ??
              action.error ??
              quota.error ??
              preview.error ??
              invoice.error
            }
          />
        </div>
      )}
    </Card>
  );
}
