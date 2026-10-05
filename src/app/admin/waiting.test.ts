import { describe, expect, it } from "vitest";
import { adminT } from "@/app/i18n/admin";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { buildAdminNav, type NavShop } from "./nav-model";
import { waitingTiles, type NavShopWaiting } from "./waiting";

const shop = (over: Partial<NavShopWaiting> = {}): NavShopWaiting => ({
  role: "owner",
  vertical: "confectionery",
  modules: {},
  ticketsOpen: 0,
  homeworkWaiting: 0,
  undelivered: 0,
  ...over,
});
const tiles = (s: NavShopWaiting, receipts = 0) => waitingTiles(buildAdminNav(s), s, receipts);
const keys = (s: NavShopWaiting, receipts = 0) => tiles(s, receipts).map((t) => t.key);
const badgeOf = (s: NavShop, to: string) =>
  buildAdminNav(s)
    .groups.flatMap((g) => g.items)
    .find((i) => i.to === to)?.badge?.value;

describe("«Ждёт вас» на главной", () => {
  it("ничего не ждёт — плиток нет", () => {
    expect(tiles(shop())).toEqual([]);
  });

  it("числа совпадают с бейджами меню и ведут в нужную очередь", () => {
    const s = shop({
      modules: { manager_chat: true, helpdesk: true, courses: true },
      chatUnread: 4,
      ticketsOpen: 2,
      homeworkWaiting: 3,
      undelivered: 5,
    });
    const t = Object.fromEntries(tiles(s, 7).map((x) => [x.key, x]));
    expect(t.inbox!.count).toBe(badgeOf(s, "/admin/chat"));
    expect(t.tickets!.count).toBe(badgeOf(s, "/admin/tickets"));
    expect(t.homework!.count).toBe(badgeOf(s, "/admin/homework"));
    expect(t.undelivered!.count).toBe(badgeOf(s, "/admin/undelivered"));
    expect(t.receipts).toMatchObject({
      count: 7,
      to: "/admin/orders",
      search: { status: "awaiting_confirmation" },
    });
    expect(t.inbox!.to).toBe("/admin/chat");
    expect(t.undelivered!.to).toBe("/admin/undelivered");
  });

  it("выключенный модуль — плитки нет, даже если число осталось", () => {
    const s = shop({ chatUnread: 4, ticketsOpen: 2, homeworkWaiting: 3 });
    expect(keys(s)).toEqual([]);
    expect(keys(shop({ modules: { manager_chat: true }, chatUnread: 1 }))).toEqual(["inbox"]);
  });

  it("бухгалтеру — только чеки на проверке", () => {
    const s = shop({
      role: "accountant",
      modules: { manager_chat: true, helpdesk: true, courses: true },
      chatUnread: 4,
      ticketsOpen: 2,
      homeworkWaiting: 3,
      undelivered: 5,
    });
    expect(keys(s, 3)).toEqual(["receipts"]);
  });

  it("ошибка чтения — «не удалось загрузить», а не «0»", () => {
    const s = shop({
      modules: { manager_chat: true, helpdesk: true, courses: true },
      chatUnread: null,
      waitingFailed: ["tickets", "homework", "undelivered"],
    });
    const t = Object.fromEntries(tiles(s).map((x) => [x.key, x.count]));
    expect(t).toEqual({ undelivered: null, inbox: null, tickets: null, homework: null });
  });

  for (const lang of SUPPORTED_LOCALES)
    it(`${lang}: подписи плиток и блока на месте`, () => {
      const t = adminT(lang);
      const s = shop({
        modules: { manager_chat: true, helpdesk: true, courses: true },
        chatUnread: 1,
        ticketsOpen: 1,
        homeworkWaiting: 1,
        undelivered: 1,
      });
      for (const tile of tiles(s, 1)) expect(t(tile.label)).not.toBe(tile.label);
      for (const k of [
        "waiting.title",
        "waiting.empty",
        "waiting.failed",
        "waiting.open",
        "pace.title",
        "pace.none",
        "pace.noBase",
        "pace.same",
        "pace.byHour",
      ] as const)
        expect(t(k)).not.toBe(k);
    });
});
