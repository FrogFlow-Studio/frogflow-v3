import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CONSULTANT_LIMIT_MAX } from "@/core/consultant/budget";
import { SMART_SEARCH_USD_MAX } from "@/core/search/smart-pure";

/**
 * Серверные функции панели оператора: настройки ИИ-консультанта клиента.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

const impl = () => import("./operator.server");

const botId = z.string().uuid();

/** Дневной предел ИИ-консультанта клиенту с большим потоком; null — общий предел. */
export const setConsultantLimitsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const n = (max: number, int: boolean) =>
      (int ? z.number().int() : z.number()).min(0).max(max).nullable();
    return z
      .object({
        botId,
        limits: z
          .object({
            dailyUsd: n(CONSULTANT_LIMIT_MAX.dailyUsd, false),
            dailyCalls: n(CONSULTANT_LIMIT_MAX.dailyCalls, true),
            dailyTests: n(CONSULTANT_LIMIT_MAX.dailyTests, true),
          })
          .nullable(),
      })
      .parse(d);
  })
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setConsultantLimits(data.botId, data.limits, await actor());
    return { ok: true };
  });

/** Консультант ищет по каталогу инструментом — для больших каталогов. */
export const setConsultantSearchFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, on: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setConsultantSearch(data.botId, data.on, await actor());
    return { ok: true };
  });

/** «Сценарий продавца v2»: короткий ответ и кнопка «Купить» вместо прайса и вопроса. */
export const setConsultantPlaybookFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, on: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setConsultantPlaybook(data.botId, data.on, await actor());
    return { ok: true };
  });

/** Прогрев кеша консультанта по прайсу: после 54 минут тишины — короткий вызов за счёт платформы. */
export const setConsultantCacheWarmFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, on: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setConsultantCacheWarm(data.botId, data.on, await actor());
    return { ok: true };
  });

/** Консультант «по прайсу» (BOVI): прайс 1С, рубли по курсу банка, нерабочие часы. */
export const setConsultantPricelistFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, on: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setConsultantPricelist(data.botId, data.on, await actor());
    return { ok: true };
  });

export const setConsultantPricelistOptionsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        hours: z
          .object({ open: z.number().int().min(0).max(24), close: z.number().int().min(0).max(24) })
          .nullable(),
        rateSource: z.enum(["vtb", "finkaz", "manual"]),
        rateUrl: z.string().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { botId: id, ...options } = data;
    await (await impl()).setConsultantPricelistOptions(id, options, await actor());
    return { ok: true };
  });

/** Консультант по прайсу у оператора: сводка, модель и цена хода за 7 дней (null — выключен). */
export const clientConsultantViewFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./consultant-view.server")).consultantOperatorView(data.botId);
  });

/** Модель консультанта по прайсу; "" — модель платформы. Список проверяет сервер. */
export const setConsultantModelFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, model: z.string().max(80) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (
      await import("./consultant-view.server")
    ).setConsultantModel(data.botId, data.model, await actor());
    return { ok: true };
  });

/** Дневной предел умного поиска клиента в долларах; null — общий предел. */
export const setSmartSearchLimitFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, dailyUsd: z.number().min(0).max(SMART_SEARCH_USD_MAX).nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setSmartSearchLimit(data.botId, data.dailyUsd, await actor());
    return { ok: true };
  });
