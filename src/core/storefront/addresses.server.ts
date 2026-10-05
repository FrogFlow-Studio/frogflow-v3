import {
  claimStateSection,
  getCustomerByTelegramId,
  type Customer,
} from "@/core/customers/customers";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  addAddress,
  editAddress,
  parseAddresses,
  removeAddress,
  type AddressChange,
  type SavedAddress,
} from "./addresses";

/**
 * Запись и чтение сохранённых адресов (К5). `telegramId` приходит только из подписанной
 * сессии витрины (вход через Telegram или по коду): без входа сюда не попасть. Карточка
 * сайта по почте не подходит — у неё входа нет. Пишем точечно, условной записью секции
 * `web_addr` (по её `rev` и `state.mode`): остальное состояние, которое параллельно пишут
 * бот и v1, не затирается; баллы и заказы здесь не трогаются.
 */
async function ownCard(ctx: TenantContext, telegramId: number): Promise<Customer | null> {
  const c = await getCustomerByTelegramId(ctx, telegramId);
  return c && c.platform !== "web" && c.telegramId === telegramId ? c : null;
}

export type AddressResult =
  | { ok: true; items: SavedAddress[] }
  | { ok: false; reason: "full" | "unknown" | "bad_text" | "no_card" };

export async function listAddresses(
  ctx: TenantContext,
  telegramId: number,
): Promise<SavedAddress[] | null> {
  const c = await ownCard(ctx, telegramId);
  if (!c) return null;
  const raw = (c.state as { web_addr?: { items?: unknown } }).web_addr?.items;
  return parseAddresses(raw);
}

async function change(
  ctx: TenantContext,
  telegramId: number,
  apply: (items: readonly SavedAddress[]) => AddressChange,
): Promise<AddressResult> {
  const c = await ownCard(ctx, telegramId);
  if (!c) return { ok: false, reason: "no_card" };
  let result: AddressResult = { ok: true, items: [] };
  await claimStateSection(ctx, c, "web_addr", (current) => {
    const items = parseAddresses(current.items);
    const r = apply(items);
    if (!r.ok) {
      result = r;
      return null;
    }
    result = { ok: true, items: r.items ?? items };
    return r.items === null ? null : { items: r.items };
  });
  return result;
}

export const saveAddress = (ctx: TenantContext, telegramId: number, text: unknown) =>
  change(ctx, telegramId, (items) => addAddress(items, text));

export const updateAddress = (ctx: TenantContext, telegramId: number, id: unknown, text: unknown) =>
  change(ctx, telegramId, (items) => editAddress(items, id, text));

export const deleteAddress = (ctx: TenantContext, telegramId: number, id: unknown) =>
  change(ctx, telegramId, (items) => removeAddress(items, id));
