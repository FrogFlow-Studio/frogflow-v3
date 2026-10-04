import { getCustomerByTelegramId, claimStateSection } from "@/core/customers/customers";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { mergeFavorites, parseFavorites } from "./favorites";

/**
 * Избранное вошедшего покупателя хранится у него в магазине (bot_users.state.web_fav),
 * чтобы не потерялось со сменой телефона. Пишем точечно, через условную запись
 * claimStateSection (по `rev` секции и `state.mode`): остальное состояние, которое
 * параллельно пишут бот и v1, не затирается.
 *
 * `merge` — при входе и при первом открытии: избранное из браузера и сохранённое
 * складываются, ничего не теряется. `replace` — после нажатия сердечка: список в
 * браузере и есть правда, снятое сердечко не должно вернуться из сохранённого.
 * Нет покупателя в магазине — null, избранное остаётся только в браузере.
 */
export async function syncServerFavorites(
  ctx: TenantContext,
  telegramId: number,
  local: readonly string[],
  mode: "merge" | "replace",
): Promise<string[] | null> {
  const customer = await getCustomerByTelegramId(ctx, telegramId);
  if (!customer) return null;
  let result: string[] = [];
  await claimStateSection(ctx, customer, "web_fav", (current) => {
    const saved = parseFavorites(JSON.stringify(current.ids ?? []));
    const next =
      mode === "merge" ? mergeFavorites(local, saved) : parseFavorites(JSON.stringify(local));
    result = next;
    return next.length === saved.length && next.every((id, i) => id === saved[i])
      ? null
      : { ids: next };
  });
  return result;
}
