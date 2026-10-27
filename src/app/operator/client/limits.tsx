/** Карточка клиента у оператора: дневные пределы ИИ-консультанта и умного поиска. */
import { type FormEvent } from "react";
import { type getClientFn } from "@/app/operator/clients.functions";
import {
  setConsultantCacheWarmFn,
  setConsultantLimitsFn,
  setConsultantPlaybookFn,
  setConsultantPricelistFn,
  setConsultantPricelistOptionsFn,
  setConsultantSearchFn,
  setSmartSearchLimitFn,
} from "@/app/operator/client-consultant.functions";
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
  const togglePlaybook = useAction(async (on: boolean) => {
    await setConsultantPlaybookFn({ data: { botId: c.id, on } });
    await onDone();
  });
  const toggleCacheWarm = useAction(async (on: boolean) => {
    await setConsultantCacheWarmFn({ data: { botId: c.id, on } });
    await onDone();
  });
  const togglePricelist = useAction(async (on: boolean) => {
    await setConsultantPricelistFn({ data: { botId: c.id, on } });
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
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={budget.playbook}
          disabled={togglePlaybook.busy}
          onChange={(e) => void togglePlaybook.run(e.currentTarget.checked).catch(() => {})}
        />
        <span>
          Сценарий продавца v2
          <span className="block text-xs text-muted">
            Магазин в переписке с кнопкой «Купить»: короткий ответ (что это, цена, польза) и кнопка
            вместо прайса и вопроса «Оформляем заказ?», понятный вариант — сразу на кнопку.
            Выключено — прежний сценарий.
          </span>
        </span>
      </label>
      <ErrorBox error={togglePlaybook.error} />
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={budget.pricelist}
          disabled={togglePricelist.busy}
          onChange={(e) => void togglePricelist.run(e.currentTarget.checked).catch(() => {})}
        />
        <span>
          Консультант по прайсу (BOVI)
          <span className="block text-xs text-muted">
            Отвечает по прайсу 1С из настроек консультанта, а не по товарам магазина: размеры,
            цвета, жёсткость, бюджет, цены в рублях по курсу банка, нерабочие часы. Новому клиенту
            ниши «Консультант (ун. BOVI)» включается сам, пока вы его не выключите.
          </span>
        </span>
      </label>
      <ErrorBox error={togglePricelist.error} />
      {budget.pricelist && <PricelistOptions c={c} budget={budget} onDone={onDone} />}
      {budget.pricelist && (
        <>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={budget.cacheWarm}
              disabled={toggleCacheWarm.busy}
              onChange={(e) => void toggleCacheWarm.run(e.currentTarget.checked).catch(() => {})}
            />
            <span>
              Прогрев кеша консультанта
              <span className="block text-xs text-muted">
                Если консультант 54 минуты не отвечал, короткий вызов модели продлевает кеш
                подсказки с прайсом ещё на час: следующий ответ читает прайс из кеша, а не
                записывает заново. Платит платформа, с ИИ-баланса клиента не списывается, расход
                пишется отдельно от ответов. Выключено — без прогрева.
              </span>
            </span>
          </label>
          <ErrorBox error={toggleCacheWarm.error} />
        </>
      )}
    </Card>
  );
}

/** Часы магазина и источник курса рубля консультанта по прайсу. */
function PricelistOptions({
  c,
  budget,
  onDone,
}: {
  c: C;
  budget: CB;
  onDone: () => Promise<void>;
}) {
  const o = budget.pricelistOptions;
  const save = useAction(async (f: FormData) => {
    const open = String(f.get("open") ?? "").trim();
    const close = String(f.get("close") ?? "").trim();
    await setConsultantPricelistOptionsFn({
      data: {
        botId: c.id,
        hours: open && close ? { open: Number(open), close: Number(close) } : null,
        rateSource: String(f.get("rateSource")) as "vtb" | "finkaz" | "manual",
        rateUrl: String(f.get("rateUrl") ?? ""),
      },
    });
    await onDone();
  });
  return (
    <form
      className="mt-3 space-y-3 border-t border-line pt-3"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        void save.run(new FormData(e.currentTarget)).catch(() => {});
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Открытие, час" hint="по поясу магазина; пусто — 10">
          <input
            className="input"
            name="open"
            type="number"
            min={0}
            max={24}
            defaultValue={o.hours?.open ?? ""}
          />
        </Field>
        <Field label="Закрытие, час" hint="пусто — 21">
          <input
            className="input"
            name="close"
            type="number"
            min={0}
            max={24}
            defaultValue={o.hours?.close ?? ""}
          />
        </Field>
        <Field label="Курс рубля">
          <select className="input" name="rateSource" defaultValue={o.rateSource}>
            <option value="vtb">ВТБ (через ретранслятор)</option>
            <option value="finkaz">Kaspi и др. (finkaz.kz)</option>
            <option value="manual">вручную у продавца</option>
          </select>
        </Field>
        <Field label="Страница finkaz" hint="по умолчанию Kaspi">
          <input
            className="input"
            name="rateUrl"
            defaultValue={o.rateUrl}
            placeholder="https://finkaz.kz/kaspi-bank/exchange-rates"
          />
        </Field>
      </div>
      <button className="btn-secondary" disabled={save.busy}>
        Сохранить часы и курс
      </button>
      <ErrorBox error={save.error} />
    </form>
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
