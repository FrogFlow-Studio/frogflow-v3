/**
 * Рубли для BOVI (перенос src/lib/consultant/rate.ts v1): формула продавца
 * ₸ / (курс покупки × 0,95), в выходные × 0,93; свежесть курса. Чтение и
 * обновление курса по магазину — rate.server.ts. Выходные и часы — по
 * Алматы, как у банка и продавца.
 */
/**
 * Определение выходного дня по времени Алматы (Asia/Almaty, UTC+5).
 */
export function isWeekendInAlmaty(date: Date = new Date()): boolean {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Almaty",
      weekday: "short",
    }).format(date);
    return weekday === "Sat" || weekday === "Sun";
  } catch {
    const utcDay = new Date(date.getTime() + 5 * 60 * 60 * 1000).getUTCDay();
    return utcDay === 0 || utcDay === 6;
  }
}

/**
 * Текущий час по времени Алматы (0..23).
 */
export function getAlmatyHour(date: Date = new Date()): number {
  try {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Almaty",
      hour: "numeric",
      hour12: false,
    }).format(date);
    const parsed = parseInt(hourStr, 10);
    return isNaN(parsed) ? 12 : parsed % 24;
  } catch {
    const utcHour = new Date(date.getTime() + 5 * 60 * 60 * 1000).getUTCHours();
    return utcHour;
  }
}

/**
 * Нерабочие часы магазина в Алматы (после 21:00 и ночью до 10:00 утра).
 */
export function isOffHoursInAlmaty(date: Date = new Date()): boolean {
  const hour = getAlmatyHour(date);
  return hour >= 21 || hour < 10;
}

/**
 * Коэффициент конвертации:
 * - Будние дни: Покупка рубля ВТБ Казахстан - 5% (множитель 0.95).
 * - Выходные (Сб, Вс): Покупка рубля ВТБ Казахстан - 7% (множитель 0.93).
 *   За базу берётся последняя цена пятницы.
 * - В понедельник: автоматический возврат к обычной формуле (0.95).
 */
export function getRubMultiplier(date: Date = new Date()): number {
  return isWeekendInAlmaty(date) ? 0.93 : 0.95;
}

/**
 * RUB = KZT / (VTB KZ buy rate × multiplier). Считает backend, не Claude.
 * Пример из ТЗ (будни): 45 000 / (5.15 × 0.95) ≈ 9 198 ₽.
 * Выходные: 45 000 / (5.15 × 0.93) ≈ 9 396 ₽.
 */
export function priceRub(priceKzt: number, vtbBuyRate: number, date: Date = new Date()): number {
  if (!(priceKzt > 0) || !(vtbBuyRate > 0)) return 0;
  const multiplier = getRubMultiplier(date);
  return Math.round(priceKzt / (vtbBuyRate * multiplier));
}

/**
 * Обратный пересчёт: бюджет покупателя в рублях → потолок в тенге по той же
 * формуле, что priceRub (позиция с этой ценой в тенге покажется ему ровно в
 * этот бюджет). BOVI 04.10: «бюджет до 80 тыс» из России приняли за тенге.
 */
export function rubToKzt(rub: number, vtbBuyRate: number, date: Date = new Date()): number {
  if (!(rub > 0) || !(vtbBuyRate > 0)) return 0;
  return Math.round(rub * vtbBuyRate * getRubMultiplier(date));
}

export type StoredVtbRate = {
  /** Курс покупки рубля банком — от него считается цена в ₽. */
  rate: number;
  updatedAt: string;
  /** URL источника или `manual`. */
  source?: string;
  /**
   * Курс продажи из той же котировки. В расчёте не участвует и нужен только
   * для показа в админке: продавец спрашивал, не подставляем ли мы продажу
   * вместо покупки, и по двум числам рядом это видно сразу.
   */
  sell?: number;
};

/**
 * Сколько курс считается точным. Курс обновляется кроном раз в 15 минут;
 * старше суток — источник сломан, и рубли покупателю идут по последнему
 * известному курсу с пометкой «ориентировочно» (toTurn). Совсем без рублей
 * бот не остаётся, пока есть хоть какой-то курс: 09.10 BOVI трое суток
 * держал курс, а на четвёртые молча перестал называть рубли россиянам
 * (прежний предел — 72 ч).
 */
export const RATE_APPROX_AFTER_HOURS = 24;

/**
 * Через сколько часов без обновления курса — сигнал оператору (крон health,
 * platform-alerts): курс должен обновляться каждые 15 минут, и шесть часов
 * тишины — уже поломка источника, а не заминка.
 */
export const RATE_ALERT_AFTER_HOURS = 6;

/**
 * Источник курса магазина. Не выбран — Kaspi через finkaz.kz: так курс брал
 * BOVI в v1, и так его берёт обновление (rate.server). Панели показывают то
 * же значение: форма с «ВТБ» по умолчанию при сохранении записывала ВТБ, а
 * ВТБ без ретранслятора не отвечает — курс BOVI протух (07.10).
 */
export function effectiveRateSource(
  cfg: { rate_source?: "vtb" | "finkaz" | "manual" } | null | undefined,
): "vtb" | "finkaz" | "manual" {
  return cfg?.rate_source ?? "finkaz";
}

/** Возраст курса в часах; нет курса или битая дата — null. */
export function rateAgeHours(rate: StoredVtbRate | null, now: number = Date.now()): number | null {
  if (!rate?.rate) return null;
  const ageHours = (now - Date.parse(rate.updatedAt)) / 36e5;
  return Number.isFinite(ageHours) ? ageHours : null;
}

/** Курс точный (моложе суток). Старше — рубли идут с пометкой «ориентировочно». */
export function isRateFresh(rate: StoredVtbRate | null, now: number = Date.now()): boolean {
  const age = rateAgeHours(rate, now);
  return age !== null && age <= RATE_APPROX_AFTER_HOURS;
}

/** Курс из строки app_settings; испорченное или пустое — null. */
export function parseStoredRate(raw: string | null | undefined): StoredVtbRate | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredVtbRate>;
    const rate = Number(parsed.rate);
    if (!(rate > 0) || !parsed.updatedAt) return null;
    const sell = Number(parsed.sell);
    return {
      rate,
      updatedAt: String(parsed.updatedAt),
      source: parsed.source ? String(parsed.source) : undefined,
      ...(sell > 0 ? { sell } : {}),
    };
  } catch {
    return null;
  }
}
