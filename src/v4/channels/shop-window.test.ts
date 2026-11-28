import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedKopilka } from "../test/kopilka";
import { pgliteV4, v4Db } from "../test/pg";
import { touchBuyer } from "../core/platform";
import { createOffer } from "../seller/offers";
import { buyInShop } from "./shop-window";

const K = "c0c0c0c0-0000-4000-8000-0000000005c1";
let pg: PGlite;
let ids: Map<string, string>;
const db = () => pgliteV4(pg, { botId: K });

beforeAll(async () => {
  pg = await v4Db();
  ids = await seedKopilka(pg, K);
});
afterAll(() => pg.close());

const ordersOf = async (telegramId: string) =>
  Number(
    (
      await pg.query<{ n: number }>(
        `select count(*)::int n from v4.orders o
         join v4.buyer_channels c on c.buyer_id = o.buyer_id
         where c.bot_id = $1 and c.channel = 'telegram' and c.external_id = $2`,
        [K, telegramId],
      )
    ).rows[0]!.n,
  );

describe("покупка из Mini App", () => {
  it("код из чата и окно магазина — один заказ, второе нажатие тот же", async () => {
    const buyerId = await touchBuyer(db(), {
      botId: K,
      channel: "telegram",
      externalId: "555",
      country: "KZ",
    });
    const made = await createOffer(db(), {
      botId: K,
      buyerId,
      productIds: [ids.get("Палитра средств выразительности")!],
      mode: "live",
    });
    if (!made.ok) throw new Error(made.reason);
    const first = await buyInShop(db(), {
      botId: K,
      telegramId: "555",
      country: "KZ",
      productIds: [ids.get("Палитра средств выразительности")!],
      claimId: "tap-1",
      offerId: made.offer.offerId,
    });
    const second = await buyInShop(db(), {
      botId: K,
      telegramId: "555",
      country: "KZ",
      productIds: [ids.get("Палитра средств выразительности")!],
      claimId: "tap-2",
      offerId: made.offer.offerId,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.orderId).toBe(first.orderId);
      expect(second.reused).toBe(true);
      expect(first.no).toBeGreaterThan(0);
    }
    expect(await ordersOf("555")).toBe(1);
  });

  it("корзина без кода: повтор того же ключа не создаёт второй заказ", async () => {
    const id = ids.get("Небосвод писателей")!;
    const first = await buyInShop(db(), {
      botId: K,
      telegramId: "556",
      country: "KZ",
      productIds: [id],
      claimId: "cart-1",
    });
    const again = await buyInShop(db(), {
      botId: K,
      telegramId: "556",
      country: "KZ",
      productIds: [id],
      claimId: "cart-1",
    });
    expect(first.ok).toBe(true);
    expect(again).toEqual({ ok: false, code: "duplicate" });
    expect(await ordersOf("556")).toBe(1);
  });

  it("чужой код не списывает чужое предложение", async () => {
    const buyerId = await touchBuyer(db(), {
      botId: K,
      channel: "telegram",
      externalId: "557",
      country: "KZ",
    });
    const made = await createOffer(db(), {
      botId: K,
      buyerId,
      productIds: [ids.get("Палитра средств выразительности")!],
      mode: "live",
    });
    if (!made.ok) throw new Error(made.reason);
    const stolen = await buyInShop(db(), {
      botId: K,
      telegramId: "558",
      country: "KZ",
      productIds: [ids.get("Палитра средств выразительности")!],
      claimId: "steal",
      offerId: made.offer.offerId,
    });
    expect(stolen).toEqual({ ok: false, code: "not_found" });
    expect(await ordersOf("557")).toBe(0);
    expect(await ordersOf("558")).toBe(0);
  });
});
