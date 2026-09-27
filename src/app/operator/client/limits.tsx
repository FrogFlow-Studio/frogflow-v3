/** Карточка клиента у оператора: дневные пределы ИИ-консультанта и умного поиска. */
import { type FormEvent } from "react";
import {
  type getClientFn,
  setConsultantLimitsFn,
  setConsultantSearchFn,
  setSmartSearchLimitFn,
} from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import type { C } from "./types";

type CB = Awaited<ReturnType<typeof getClientFn>>["consultant"];
type Limits = { dailyUsd: number | null; dailyCalls: number | null; dailyTests: number | null };

/** Дневной предел ИИ-консультанта: общий по умолчанию, клиенту с большим потоком — свой. */
export function ConsultantLimitsCard({
  c,
  budget,
  onDone,
}: {
  c: C;
  budget: CB;
  onDone: () => Promise<void>;
}) {
  const save = useAction(async (limits: Limits | null) => {
    await setConsultantLimitsFn({ data: { botId: c.id, limits } });
    await onDone();
  });
  const toggleSearch = useAction(async (on: boolean) => {
    await setConsultantSearchFn({ data: { botId: c.id, on } });
    await onDone();
  });
  const { limits, defaults, max, today: t } = budget;
  const num = (f: FormData, k: string) => {
    const v = String(f.get(k) ?? "")
      .trim()
      .replace(",", ".");
    return v === "" ? null : Number(v);
  };
  return (
    <Card title="Предел ИИ-консультанта в день">
      <p className="mb-3 text-sm text-muted">
        Сегодня (UTC): ${t.usd.toFixed(2)} из ${limits.dailyUsd}, ответов {t.calls} из{" "}
        {limits.dailyCalls}, проб {t.tests} из {limits.dailyTests}.{" "}
        {budget.custom ? <Badge tone="warn">свой предел</Badge> : <Badge>общий предел</Badge>}
      </p>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save
            .run({
              dailyUsd: num(f, "dailyUsd"),
              dailyCalls: num(f, "dailyCalls"),
              dailyTests: num(f, "dailyTests"),
            })
            .catch(() => {});
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Расход, $" hint={`общий ${defaults.dailyUsd}, до ${max.dailyUsd}`}>
            <input
              className="input"
              name="dailyUsd"
              type="number"
              min={0}
              max={max.dailyUsd}
              step="0.5"
              defaultValue={budget.custom ? limits.dailyUsd : ""}
              placeholder={String(defaults.dailyUsd)}
            />
          </Field>
          <Field label="Ответов" hint={`общий ${defaults.dailyCalls}`}>
            <input
              className="input"
              name="dailyCalls"
              type="number"
              min={0}
              max={max.dailyCalls}
              step="1"
              defaultValue={budget.custom ? limits.dailyCalls : ""}
              placeholder={String(defaults.dailyCalls)}
            />
          </Field>
          <Field label="Проб из админки" hint={`общий ${defaults.dailyTests}`}>
            <input
              className="input"
              name="dailyTests"
              type="number"
              min={0}
              max={max.dailyTests}
              step="1"
              defaultValue={budget.custom ? limits.dailyTests : ""}
              placeholder={String(defaults.dailyTests)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Пустое поле — общий предел. 0 — ИИ клиенту выключен. Расход идёт с ключа платформы.
        </p>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={save.busy}>
            Сохранить предел
          </button>
          {budget.custom && (
            <button
              type="button"
              className="btn-ghost"
              disabled={save.busy}
              onClick={() => void save.run(null).catch(() => {})}
            >
              Вернуть общий
            </button>
          )}
        </div>
        <ErrorBox error={save.error} />
      </form>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={budget.search}
          disabled={toggleSearch.busy}
          onChange={(e) => void toggleSearch.run(e.currentTarget.checked).catch(() => {})}
        />
        <span>
          Расширенный консультант
          <span className="block text-xs text-muted">
            Сам ищет товары по всему каталогу (в подсказке только категории), помнит, что покупатель
            уже сказал, и перед передачей покупки менеджеру спрашивает телефон. Выключено — первые
            120 товаров в подсказке.
          </span>
        </span>
      </label>
      <ErrorBox error={toggleSearch.error} />
    </Card>
  );
}

type SB = Awaited<ReturnType<typeof getClientFn>>["smartSearch"];

export function SmartSearchLimitCard({
  c,
  budget,
  onDone,
}: {
  c: C;
  budget: SB;
  onDone: () => Promise<void>;
}) {
  const save = useAction(async (dailyUsd: number | null) => {
    await setSmartSearchLimitFn({ data: { botId: c.id, dailyUsd } });
    await onDone();
  });
  return (
    <Card title="Предел умного поиска в день">
      <p className="mb-3 text-sm text-muted">
        Сегодня (UTC): ${budget.todayUsd.toFixed(2)} из ${budget.limitUsd}.{" "}
        {budget.custom ? <Badge tone="warn">свой предел</Badge> : <Badge>общий предел</Badge>}
      </p>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const v = String(new FormData(e.currentTarget).get("dailyUsd") ?? "")
            .trim()
            .replace(",", ".");
          void save.run(v === "" ? null : Number(v)).catch(() => {});
        }}
      >
        <Field label="Расход, $" hint={`общий ${budget.defaultUsd}, до ${budget.maxUsd}`}>
          <input
            className="input"
            name="dailyUsd"
            type="number"
            min={0}
            max={budget.maxUsd}
            step="0.5"
            defaultValue={budget.custom ? budget.limitUsd : ""}
            placeholder={String(budget.defaultUsd)}
          />
        </Field>
        <p className="text-xs text-muted">
          Пустое поле — общий предел. 0 — умный поиск клиенту выключен. Расход идёт с ключа
          платформы.
        </p>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={save.busy}>
            Сохранить предел
          </button>
          {budget.custom && (
            <button
              type="button"
              className="btn-ghost"
              disabled={save.busy}
              onClick={() => void save.run(null).catch(() => {})}
            >
              Вернуть общий
            </button>
          )}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
