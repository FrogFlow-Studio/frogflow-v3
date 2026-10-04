import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { inboxEventId, type InboxFilter } from "./inbox";
import { listUnreadIds } from "@/core/chat/chat";
import { INBOX_PAGE, inboxTotals, listInboxChanged, listInboxPage } from "./page";

const BOT = "11111111-1111-1111-1111-111111111111";
const ALL: InboxFilter = { status: "all", who: "all", channel: "all" };
const T0 = Date.UTC(2026, 0, 1);

/** 3000 диалогов: по 3 на одну секунду (граница страницы падает внутрь одинакового времени). */
function setup(total = 3000) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.manager_chat_state = Array.from({ length: total }, (_, i) => ({
    bot_id: BOT,
    telegram_id: i + 1,
    active: false,
    last_message_at: new Date(T0 + Math.floor(i / 3) * 1000).toISOString(),
    last_message_preview: `m${i + 1}`,
    last_message_direction: "in",
    unread_count: i % 10 === 0 ? 2 : 0,
  }));
  db.tables.bot_users = Array.from({ length: total }, (_, i) => ({
    bot_id: BOT,
    telegram_id: i + 1,
    user_key: `k${i + 1}`,
    // Покупатель «Редкая» — во 2-й тысяче от свежих (i = 1500 → 1500-й с конца ≈ 1500).
    first_name: i === 1500 ? "Редкая" : `Покупатель${i + 1}`,
    username: i === 1500 ? "rare_buyer" : null,
    platform: i % 3 === 0 ? "instagram" : "telegram",
  }));
  db.tables.zernio_logs = [
    // №2 решён, №3 назначен на anna, №6 назначен на boris, №9 решён и назначен на boris.
    ...[
      [2, "closed", null],
      [3, "open", "anna"],
      [6, "open", "boris"],
      [9, "closed", "boris"],
    ].map(([id, status, assignee]) => ({
      bot_id: BOT,
      event_id: inboxEventId(BOT, id as number),
      event_type: "inbox",
      status,
      payload: { telegram_id: id, assignee },
    })),
  ];
  const ctx = {
    tenant: { id: BOT, modules: { helpdesk: false } },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

describe("страницы списка диалогов", () => {
  it("3000 диалогов: страницы без пропусков и повторов, свежие сверху", async () => {
    const { ctx } = setup();
    const seen: number[] = [];
    let before = null as { last_message_at: string; telegram_id: number } | null;
    let pages = 0;
    for (;;) {
      const page = await listInboxPage(ctx, { filter: ALL, me: "", before });
      pages++;
      expect(page.items.length).toBeLessThanOrEqual(INBOX_PAGE);
      seen.push(...page.items.map((i) => i.telegram_id));
      if (!page.hasMore) break;
      const last = page.items[page.items.length - 1]!;
      before = { last_message_at: last.last_message_at, telegram_id: last.telegram_id };
    }
    expect(pages).toBe(3000 / INBOX_PAGE);
    expect(seen).toHaveLength(3000);
    expect(new Set(seen).size).toBe(3000);
    // По убыванию времени, при равном времени — по убыванию telegram_id: то есть просто 3000…1.
    expect(seen).toEqual(Array.from({ length: 3000 }, (_, i) => 3000 - i));
  });

  it("поиск находит диалог из 2-й тысячи по имени и по @username", async () => {
    const { ctx } = setup();
    for (const search of ["редк", "@RARE_buyer"]) {
      const page = await listInboxPage(ctx, { filter: { ...ALL, search }, me: "" });
      expect(page.items.map((i) => i.telegram_id)).toEqual([1501]);
      expect(page.hasMore).toBe(false);
    }
  });

  it("фильтры статуса, «мои», канала и «непрочитанные» — как в инбоксе", async () => {
    const { ctx } = setup();
    const ids = async (f: Partial<InboxFilter>, me = "boris", limit = 1000) =>
      (await listInboxPage(ctx, { filter: { ...ALL, ...f }, me, limit })).items.map(
        (i) => i.telegram_id,
      );
    expect(await ids({ status: "closed" })).toEqual([9, 2]);
    expect(await ids({ who: "mine" })).toEqual([9, 6]);
    expect(await ids({ who: "mine", status: "open" })).toEqual([6]);
    // Открытых без ответственного: 3000 − 2 решённых − 2 с ответственным (3 и 6; №9 решён).
    expect(await ids({ status: "open", who: "none" }, "boris", 5000)).toHaveLength(2996);
    expect(await ids({ unread: true }, "boris", 5)).toEqual([2991, 2981, 2971, 2961, 2951]);
    // Instagram: telegram_id = 1, 4, 7, … (i % 3 == 0 → id % 3 == 1).
    expect(await ids({ channel: "instagram" }, "boris", 3)).toEqual([2998, 2995, 2992]);
    // Селективный фильтр ищет глубоко: единственный «мой» открытый — из конца списка.
    const deep = await listInboxPage(ctx, {
      filter: { ...ALL, status: "open", who: "mine" },
      me: "boris",
    });
    expect(deep.items.map((i) => i.telegram_id)).toEqual([6]);
    expect(deep.hasMore).toBe(false);
  });

  it("счётчики — по count: открытые, мои, без ответственного, непрочитанные", async () => {
    const { ctx } = setup();
    expect(await inboxTotals(ctx, "boris")).toEqual({
      total: 3000,
      open: 2998,
      mine: 1,
      unassigned: 2996,
      unread: 300,
    });
    expect(await inboxTotals(ctx, "anna")).toMatchObject({ mine: 1 });
  });

  it("опрос берёт только изменившиеся с прошлого раза", async () => {
    const { ctx } = setup();
    const since = new Date(T0 + 998 * 1000).toISOString();
    const changed = await listInboxChanged(ctx, since);
    // Секунды 998 и 999 → telegram_id 2995…3000.
    expect(changed.map((i) => i.telegram_id).sort((a, b) => a - b)).toEqual([
      2995, 2996, 2997, 2998, 2999, 3000,
    ]);
    expect(await listInboxChanged(ctx, new Date(T0 + 5000_000).toISOString())).toEqual([]);
  });

  it("опрос видит смену статуса и ответственного без новой реплики", async () => {
    const { ctx, db } = setup();
    const since = new Date(T0 + 5000_000).toISOString(); // реплик с тех пор нет ни в одном диалоге
    const at = new Date(T0 + 5000_000 + 1000).toISOString();
    const log = (id: number) =>
      db.tables.zernio_logs!.find((r) => r.event_id === inboxEventId(BOT, id))!;
    // Коллега решил №3 и назначил №7 (строки у №7 не было).
    log(3).status = "closed";
    (log(3).payload as Record<string, unknown>).updated_at = at;
    db.tables.zernio_logs!.push({
      bot_id: BOT,
      event_id: inboxEventId(BOT, 7),
      event_type: "inbox",
      status: "open",
      payload: { telegram_id: 7, assignee: "boris", updated_at: at },
    });
    const changed = await listInboxChanged(ctx, since);
    expect(changed.map((i) => [i.telegram_id, i.status, i.assignee]).sort()).toEqual([
      [3, "closed", "anna"],
      [7, "open", "boris"],
    ]);
    // Старые изменения (до границы) не возвращаются, чужой магазин тоже.
    (log(6).payload as Record<string, unknown>).updated_at = new Date(T0).toISOString();
    db.tables.zernio_logs!.push({
      bot_id: "other",
      event_id: inboxEventId("other", 8),
      event_type: "inbox",
      status: "closed",
      payload: { telegram_id: 8, updated_at: at },
    });
    expect((await listInboxChanged(ctx, since)).map((i) => i.telegram_id).sort()).toEqual([3, 7]);
  });

  it("список непрочитанных — все, постранично", async () => {
    const { ctx, db } = setup();
    const ids = await listUnreadIds(ctx);
    // unread_count > 0 у каждого десятого из 3000, без обрезки по 1000 строк.
    expect(ids).toHaveLength(300);
    expect(ids[0]).toBe(1);
    db.tables.manager_chat_state!.find((r) => r.telegram_id === 1)!.unread_count = 0;
    expect(await listUnreadIds(ctx)).toHaveLength(299);
  });
});
