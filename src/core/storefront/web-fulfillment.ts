import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { FulfillmentInput } from "@/core/orders/orders";
import type { Money } from "@/core/money/money";
import {
  activeDeliveryZones,
  fulfillmentSettings,
  maxLeadTimeDaysInCart,
  zoneFee,
} from "@/core/fulfillment/fulfillment";
import { addDaysToIso, todayInTz } from "@/core/fulfillment/pure";

/**
 * Физический заказ с сайта: способ получения, дата, зона и адрес — те же
 * правила, что в боте (шаги awaiting_fulfillment_* в Instagram/WhatsApp),
 * только одной формой. Проверяет сервер; форма лишь подсказывает.
 */
export type WebFulfillmentRequest = {
  type: "pickup" | "delivery";
  /** YYYY-MM-DD из поля даты. */
  date: string;
  zoneId?: string | null;
  address?: string | null;
  note?: string | null;
};

export type WebFulfillmentOptions = {
  pickup: boolean;
  delivery: boolean;
  zones: Array<{ id: string; name: string; fee: Money }>;
  /** Сегодня в поясе магазина: раньше дату не выбрать (срок изготовления — при оформлении). */
  today: string;
};

export async function webFulfillmentOptions(
  ctx: TenantContext,
  countryCode: string | null,
): Promise<WebFulfillmentOptions> {
  const fs = await fulfillmentSettings(ctx);
  const zones = fs.delivery ? await activeDeliveryZones(ctx) : [];
  return {
    pickup: fs.pickup,
    delivery: fs.delivery,
    zones: await Promise.all(
      zones.map(async (z) => ({
        id: z.id,
        name: z.name,
        fee: await zoneFee(ctx, z.price, countryCode),
      })),
    ),
    today: todayInTz(ctx.timezone),
  };
}

export type WebFulfillmentCheck =
  | { ok: true; input: FulfillmentInput }
  | { ok: false; reason: "missing" | "type" | "date" | "zone" | "address" }
  | { ok: false; reason: "date_early"; minDate: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Проверить выбор покупателя по корзине в базе (срок изготовления — по её товарам). */
export async function resolveWebFulfillment(
  ctx: TenantContext,
  customer: Customer,
  req: WebFulfillmentRequest | null | undefined,
  countryCode: string,
): Promise<WebFulfillmentCheck> {
  if (!req) return { ok: false, reason: "missing" };
  const fs = await fulfillmentSettings(ctx);
  if (req.type === "pickup" ? !fs.pickup : !fs.delivery) return { ok: false, reason: "type" };
  if (!validIsoDate(req.date)) return { ok: false, reason: "date" };
  const minDate = addDaysToIso(todayInTz(ctx.timezone), await maxLeadTimeDaysInCart(ctx, customer));
  if (req.date < minDate) return { ok: false, reason: "date_early", minDate };
  const note = req.note?.trim().slice(0, 500) || null;
  if (req.type === "pickup")
    return {
      ok: true,
      input: { type: "pickup", at: req.date, address: null, note, zone: null },
    };
  const address = req.address?.trim().slice(0, 500) ?? "";
  if (!address) return { ok: false, reason: "address" };
  const zones = await activeDeliveryZones(ctx);
  let zone: FulfillmentInput["zone"] = null;
  if (zones.length > 0) {
    const z = zones.find((x) => x.id === req.zoneId);
    if (!z) return { ok: false, reason: "zone" };
    zone = { id: z.id, name: z.name, fee: (await zoneFee(ctx, z.price, countryCode)).amount };
  }
  return { ok: true, input: { type: "delivery", at: req.date, address, note, zone } };
}
