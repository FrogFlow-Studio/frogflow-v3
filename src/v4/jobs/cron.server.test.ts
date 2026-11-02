import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TelegramApi, TgResult } from "@/channels/telegram/api";
import type { SendResult } from "@/channels/zernio/api.server";
import { createOrder, recordPayment } from "../core/money/money";
import type { V4Db } from "../core/db";
import { pgliteV4, v4Db } from "../test/pg";
import { runV4Cron, type V4CronDeps, type V4Shop } from "./cron.server";

/**
 * Крон v4 на настоящем Postgres. Два магазина в схеме v4: A переключён
 * (served_by = "v4"), B скопирован, но не переключён. Выдача и уведомления
 * уходят только у A; у B всё остаётся в очереди и никому не пишется.
 * Магазинов v4 нет — крон в базу не ходит.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000e1";
const B = "bbbbbbbb-0000-4000-8000-0000000000e2";
let pg: PGlite;
let n = 0;
const products: Record<string, string> = {};

type Tg = { chat: string; text: string };
function shop(botId: string, tg: Tg[], answer: TgResult = { ok: true }): V4Shop {
  const telegram: TelegramApi = {
    call: async <T>(_m: string, p?: unknown) => {
      const x = p as { chat_id: string; text: string };
      tg.push({ chat: String(x.chat_id), text: x.text });
      return answer as TgResult<T>;
    },
    fileUrl: (f) => f,
  };
  return {
    botId,
    telegram,
    zernio: { instagram: "acc-shop", whatsapp: null },
    sellerChatIds: ["5001"],
    sellerLang: "ru",
  };
}

function deps(
  over: Partial<V4CronDeps> & { tg?: Tg[]; dm?: unknown[][]; op?: string[] } = {},
): V4CronDeps {
  const tg = over.tg ?? [];
  const dm = over.dm ?? [];
  const op = over.op ?? [];
  return {
    db: pgliteV4(pg),
    botIds: [A],
    shops: async () => [shop(A, tg)],
    appUrl: "https://frogflow.tech/",
    operator: async (text) => {
      op.push(text);
      return "sent";
    },
    sendInbox: async (...args): Promise<SendResult> => {
      dm.push(args);
      return { ok: true };
    },
    ...over,
  };
}

async function paid(bot: string, channel: [string, string, string | null]) {
  const b = (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country, language) values ($1, 'KZ', 'kk') returning id",
      [bot],
    )
  ).rows[0]!.id;
  await pg.query(
    "insert into v4.buyer_channels (bot_id, channel, external_id, buyer_id, conversation_id) values ($1, $2, $3, $4, $5)",
    [bot, channel[0], channel[1], b, channel[2]],
  );
  const asBot = pgliteV4(pg, { botId: bot });
  const o = await createOrder(asBot, {
    botId: bot,
    buyerId: b,
    country: "KZ",
    productIds: [products[bot]!],
    by: "bot",
  });
  if (!o.ok) throw new Error(o.code);
  const p = await recordPayment(asBot, {
    botId: bot,
    orderId: o.value.id,
    amountMinor: o.value.totalMinor,
    currency: "KZT",
    method: "transfer",
    externalRef: `cron-${++n}`,
    by: "t",
  });
  if (!p.ok) throw new Error(p.code);
  return b;
}
const jobStatus = async (bot: string) =>
  (
    await pg.query<{ status: string }>(
      "select status from v4.jobs where bot_id = $1 and kind = 'deliver' order by id",
      [bot],
    )
  ).rows.map((r) => r.status);
const notifStatus = async (bot: string) =>
  (
    await pg.query<{ status: string }>(
      "select status from v4.notifications where bot_id = $1 order by id",
      [bot],
    )
  ).rows.map((r) => r.status);

beforeAll(async () => {
  pg = await v4Db();
  for (const bot of [A, B]) {
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [bot]);
    products[bot] = (
      await pg.query<{ id: string }>(
        "insert into v4.products (bot_id, title, kind, base_price_minor) values ($1, 'Тетрадь', 'file', 150000) returning id",
        [bot],
      )
    ).rows[0]!.id;
  }
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("крон v4", () => {
  it("магазинов v4 нет — в базу не ходит", async () => {
    const db: V4Db = {
      call: async () => {
        throw new Error("крон без магазинов v4 не должен трогать базу");
      },
    };
    for (const job of ["tick", "jobs", "notify-now", "notify-digest"] as const)
      expect(await runV4Cron(job, deps({ db, botIds: [] }))).toEqual({ shops: 0 });
  });

  it("выдача: покупатель A получает ссылку в Direct через Zernio; у B задание ждёт", async () => {
    await paid(A, ["instagram", "ig-a", "conv-a"]);
    await paid(B, ["instagram", "ig-b", "conv-b"]);
    const dm: unknown[][] = [];
    const r = await runV4Cron("jobs", deps({ dm }));
    expect(r).toMatchObject({ shops: 1, done: 1, retried: 0 });
    expect(dm).toHaveLength(1);
    const [conv, account, text, opts] = dm[0] as [string, string, string, object];
    expect([conv, account]).toEqual(["conv-a", "acc-shop"]);
    expect(text).toContain(`https://frogflow.tech/c/${A}/`);
    expect(opts).toEqual({ platform: "instagram", idempotencyScope: "v4" });
    expect(await jobStatus(A)).toEqual(["done"]);
    expect(await jobStatus(B)).toEqual(["queued"]);
    // Повтор крона второй раз не шлёт.
    const again: unknown[][] = [];
    await runV4Cron("jobs", deps({ dm: again }));
    expect(again).toEqual([]);
  });

  it("уведомления: продавцу A — в его чат со ссылкой на «Сегодня»; оператору — в чат платформы; B молчит", async () => {
    for (const bot of [A, B])
      await pg.query(
        "select v4.notify($1, 'seller', 'now', 'case_opened:channel_down', $2, null, null, '{}'::jsonb)",
        [bot, `cd-${bot}`],
      );
    await pg.query(
      "select v4.notify($1, 'operator', 'now', 'case_escalated:channel_down', 'esc-a', null, null, '{}'::jsonb)",
      [A],
    );
    const tg: Tg[] = [];
    const op: string[] = [];
    const r = await runV4Cron("notify-now", deps({ tg, op }));
    expect(r).toMatchObject({ shops: 1, sent: 2, failed: 0 });
    expect(tg).toHaveLength(1);
    expect(tg[0]!.chat).toBe("5001");
    expect(tg[0]!.text).toContain("https://frogflow.tech/admin/v4-today");
    expect(op).toHaveLength(1);
    expect(op[0]).not.toContain("v4-today");
    expect(await notifStatus(B)).toEqual(["queued"]);
  });

  it("покупателю — в его последний канал на его языке (напоминание о продлении клуба)", async () => {
    const buyer = await paid(A, ["telegram", "7007", null]);
    await pg.query(
      "select v4.notify($1, 'buyer', 'now', 'club_renew_reminder', 'renew-x', null, null, $2::jsonb)",
      [A, JSON.stringify({ buyer_id: buyer, ends_at: "2026-12-01T00:00:00Z" })],
    );
    const tg: Tg[] = [];
    const r = await runV4Cron("notify-now", deps({ tg }));
    expect(r).toMatchObject({ sent: 1 });
    expect(tg).toEqual([{ chat: "7007", text: expect.stringContaining("Клубқа") }]);
  });

  it("у покупателя нет канала — «не отправлено», без повтора", async () => {
    const b = (
      await pg.query<{ id: string }>(
        "insert into v4.buyers (bot_id, country) values ($1, 'KZ') returning id",
        [A],
      )
    ).rows[0]!.id;
    await pg.query(
      "select v4.notify($1, 'buyer', 'now', 'club_renew_reminder', 'renew-y', null, null, $2::jsonb)",
      [A, JSON.stringify({ buyer_id: b, ends_at: "2026-12-01T00:00:00Z" })],
    );
    expect(await runV4Cron("notify-now", deps())).toMatchObject({ failed: 1 });
  });

  it("шаг планировщика идёт, когда есть магазины v4", async () => {
    expect(await runV4Cron("tick", deps())).toMatchObject({ shops: 1 });
  });

  it("арендатору новые функции недоступны", async () => {
    const asA = pgliteV4(pg, { botId: A });
    await expect(asA.call("claim_jobs", { p_limit: 1, p_bot_ids: [A] })).rejects.toThrow(
      /permission/,
    );
    await expect(
      asA.call("claim_notifications", { p_urgency: "now", p_bot_ids: [A] }),
    ).rejects.toThrow(/permission/);
    await expect(asA.call("buyer_address", { p_bot_id: A, p_buyer_id: A })).rejects.toThrow(
      /permission/,
    );
  });
});
