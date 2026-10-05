/**
 * Блок «Ждёт вас» на главной (Ж1): то, что сейчас стоит бейджами в меню, собрано
 * в одном месте, и число ведёт сразу в нужную очередь. Чистая функция: плитка есть
 * только у того, что видно роли и включено модулями (берём пункты готового меню),
 * числа те же, что в бейджах меню.
 */
import type { AdminKey } from "@/app/i18n/admin";
import type { AdminNav, NavShop } from "./nav-model";

export type WaitingKey = "receipts" | "undelivered" | "inbox" | "tickets" | "homework";

export type WaitingTile = {
  key: WaitingKey;
  label: AdminKey;
  /** Куда ведёт плитка: путь и параметры поиска. */
  to: string;
  search?: Record<string, string>;
  /** `null` — число не удалось прочитать: плитка говорит об этом, а не рисует «0». */
  count: number | null;
  tone: "accent" | "warn" | "danger";
};

/** Чтения, которые при сбое дают 0 в меню, а здесь должны быть видны как сбой. */
export type NavShopWaiting = NavShop & { waitingFailed?: readonly string[] };

export function waitingTiles(
  nav: AdminNav,
  shop: NavShopWaiting,
  awaitingConfirmation: number,
): WaitingTile[] {
  const inMenu = (to: string) => nav.groups.some((g) => g.items.some((i) => i.to === to));
  const failed = new Set(shop.waitingFailed ?? []);
  const value = (key: WaitingKey, n: number | null | undefined): number | null =>
    failed.has(key) || n == null ? null : n;
  const tiles: WaitingTile[] = [];
  if (inMenu("/admin/orders"))
    tiles.push({
      key: "receipts",
      label: "waiting.receipts",
      to: "/admin/orders",
      search: { status: "awaiting_confirmation" },
      count: awaitingConfirmation,
      tone: "warn",
    });
  // Пункт меню «Недоставленные» рисуется, только когда число > 0, поэтому при сбое чтения (0) он пропадает: плитка нужна именно тогда.
  if (inMenu("/admin/undelivered") || failed.has("undelivered"))
    tiles.push({
      key: "undelivered",
      label: "nav.undelivered",
      to: "/admin/undelivered",
      count: value("undelivered", shop.undelivered),
      tone: "danger",
    });
  if (inMenu("/admin/chat"))
    tiles.push({
      key: "inbox",
      label: "nav.chat",
      to: "/admin/chat",
      count: value("inbox", shop.chatUnread),
      tone: "accent",
    });
  if (inMenu("/admin/tickets"))
    tiles.push({
      key: "tickets",
      label: "nav.tickets",
      to: "/admin/tickets",
      count: value("tickets", shop.ticketsOpen),
      tone: "accent",
    });
  if (inMenu("/admin/homework"))
    tiles.push({
      key: "homework",
      label: "homework.nav",
      to: "/admin/homework",
      count: value("homework", shop.homeworkWaiting),
      tone: "warn",
    });
  // Показываем то, что ждёт, и то, что не удалось прочитать; нули прячем.
  return tiles.filter((t) => t.count === null || t.count > 0);
}
