/**
 * Курьер по заказу (модуль `courier`): продавец вызывает курьера в
 * приложении Яндекс Доставки, inDrive или своего курьера и передаёт заказ в
 * карточке — служба, ссылка на отслеживание, телефон курьера. Покупатель
 * получает сообщение со ссылкой в своём канале, ссылка видна и на странице
 * заказа. Своей таблицы нет — событие таймлайна `courier` (zernio_logs,
 * core/orders/events); действует последнее: курьера можно сменить.
 */
import type { Json } from "@/core/db-types";
import type { OrderEvent } from "@/core/orders/events";

export const COURIER_PROVIDERS = ["yandex", "indrive", "own", "other"] as const;
export type CourierProvider = (typeof COURIER_PROVIDERS)[number];

/** В каких статусах заказ можно передать курьеру: собран или ещё в работе. */
export const COURIER_STATUSES = ["accepted", "in_production", "ready"] as const;

export const PROVIDER_NAMES: Record<CourierProvider, string> = {
  yandex: "Яндекс Доставка",
  indrive: "inDrive",
  own: "курьер магазина",
  other: "курьерская служба",
};

export type CourierState = {
  provider: CourierProvider;
  trackUrl: string | null;
  phone: string | null;
  at: string;
};

const str = (v: Json | undefined) => (typeof v === "string" && v ? v : null);

export function courierState(
  events: Array<Pick<OrderEvent, "kind" | "at" | "payload">>,
): CourierState | null {
  let s: CourierState | null = null;
  for (const e of events) {
    if (e.kind !== "courier") continue;
    const provider = e.payload.provider;
    if (!COURIER_PROVIDERS.includes(provider as CourierProvider)) continue;
    s = {
      provider: provider as CourierProvider,
      trackUrl: safeTrackUrl(str(e.payload.trackUrl)),
      phone: str(e.payload.phone),
      at: e.at,
    };
  }
  return s;
}

/** Ссылка отслеживания: только https — её увидит и откроет покупатель. */
export function safeTrackUrl(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Телефон курьера: цифры, плюс, пробелы, скобки и дефисы, 5–20 знаков. */
export function cleanPhone(raw: string | null | undefined): string | null {
  const v = raw?.trim() ?? "";
  return /^[+\d][\d\s()-]{4,19}$/.test(v) ? v : null;
}

/** Сообщение покупателю: кто везёт, где следить, как связаться. */
export function courierMessage(
  no: string | number,
  c: { provider: CourierProvider; trackUrl: string | null; phone: string | null },
): string {
  return [
    `🚚 Заказ #${no} передан курьеру (${PROVIDER_NAMES[c.provider]}).`,
    c.trackUrl ? `Следить за доставкой: ${c.trackUrl}` : null,
    c.phone ? `Телефон курьера: ${c.phone}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
