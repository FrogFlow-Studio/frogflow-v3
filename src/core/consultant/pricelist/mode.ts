import type { Tenant } from "@/core/tenant/types";

/**
 * Консультант работает «по прайсу» (BOVI): флаг оператора
 * `settings.consultant_pricelist.enabled`, а не вертикаль — вертикаль v1
 * «consultant_bovi_v2» жила в окружении деплоя, в базе её нет.
 */
export function pricelistMode(tenant: Pick<Tenant, "settings">): boolean {
  return tenant.settings.consultant_pricelist?.enabled === true;
}

/**
 * Новый клиент ниши «Консультант (ун. BOVI)» работает по прайсу сразу: без
 * флага консультант без товаров ответил бы «ничего нет», а у продавца не было
 * бы страницы «Прайс консультанта». Только если оператор флаг ещё не трогал:
 * выключенный руками остаётся выключенным. Универсальный консультант
 * (consultant_universal) отвечает по товарам магазина — его не касается.
 */
export function pricelistDefaultFor(
  vertical: string,
  current: Tenant["settings"]["consultant_pricelist"],
): { enabled: true } | null {
  return vertical === "consultant" && current === undefined ? { enabled: true } : null;
}

/** Рабочие часы по умолчанию — как у BOVI в v1: с 10 до 21 по поясу магазина. */
export const DEFAULT_HOURS = { open: 10, close: 21 } as const;

export type ShopHours = { open: number; close: number };

/** Часы магазина из настроек; кривые значения — часы BOVI по умолчанию. */
export function pricelistHours(tenant: Pick<Tenant, "settings">): ShopHours {
  const h = tenant.settings.consultant_pricelist?.hours;
  const ok = (n: unknown): n is number => typeof n === "number" && n >= 0 && n <= 24;
  return h && ok(h.open) && ok(h.close) && h.open !== h.close ? h : DEFAULT_HOURS;
}

/** Час по поясу магазина (0..23). */
export function hourIn(date: Date, timeZone: string): number {
  try {
    const h = Number(
      new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(date),
    );
    return Number.isFinite(h) ? h % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

/**
 * Нерабочее время магазина. Часы «через полночь» (open > close, ночной
 * магазин) тоже понимаются: рабочее — с open до полуночи и с полуночи до close.
 */
export function isOffHours(date: Date, hours: ShopHours, timeZone: string): boolean {
  const h = hourIn(date, timeZone);
  const open =
    hours.open < hours.close
      ? h >= hours.open && h < hours.close
      : h >= hours.open || h < hours.close;
  return !open;
}

const hh = (n: number) => `${String(n % 24).padStart(2, "0")}:00`;

/**
 * Пометка модели о нерабочем часе (v1 OFF_HOURS_NOTE). Ночью v1 говорил
 * «менеджер свяжется утром», консультант v2 — «передаю менеджеру», и
 * покупатель ждал ответа сейчас.
 */
export function offHoursNote(hours: ShopHours): string {
  return `[Сейчас нерабочее время магазина (с ${hh(hours.close)} до ${hh(hours.open)}). Менеджер ответит утром: если передаёте ему диалог, так и скажите покупателю.]`;
}
