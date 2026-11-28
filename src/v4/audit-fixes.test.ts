import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parkedAgentModel } from "./agent/model";
import { adaptTelegram } from "./channels/adapt";
import { buyFromChannel } from "./channels/buyer";
import { handleTelegramUpdate } from "./channels/inbound";
import { outboundOf, sendOnce } from "./channels/reply";
import { saveProduct } from "./core/platform";
import { pgliteV4, v4Db } from "./test/pg";

const A = "aaaaaaaa-0000-4000-8000-0000000000aa";
let pg: PGlite;
const svc = () => pgliteV4(pg);

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
}, 60_000);
afterAll(async () => pg.close());

describe("замечания проверки", () => {
  it("две фотографии одного чата — один покупатель, чужой reply не ответ продавца", async () => {
    const photo = (claim: string) =>
      adaptTelegram(svc(), {
        botId: A,
        claimId: claim,
        model: parkedAgentModel,
        loadFile: async () => new TextEncoder().encode(claim),
        update: { message: { chat: { id: 42 }, photo: [{ file_id: claim }] } },
      });
    await photo("m1");
    await photo("m2");
    const buyers = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.buyers where bot_id = $1",
      [A],
    );
    expect(buyers.rows[0]!.n).toBe(1);
    const opened = await svc().call("open_case", {
      p_bot_id: A,
      p_kind: "handoff",
      p_dedupe_key: "hand",
      p_created_by: "t",
    });
    const caseId = String(opened[0]?.case_id);
    const reply = await adaptTelegram(svc(), {
      botId: A,
      claimId: "m3",
      model: parkedAgentModel,
      update: { message: { chat: { id: 42 }, text: `reply:${caseId} привет` } },
    });
    expect(reply.kind).not.toBe("seller_reply");
    const rows = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.seller_replies where bot_id = $1",
      [A],
    );
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("сбой снимает заявку, повтор того же id обрабатывается", async () => {
    const first = await svc().call("claim_inbound", {
      p_bot_id: A,
      p_channel: "telegram",
      p_external_id: "again",
    });
    expect(first[0]?.claim_inbound).toBe(true);
    await svc().call("release_inbound", {
      p_bot_id: A,
      p_channel: "telegram",
      p_external_id: "again",
    });
    const second = await svc().call("claim_inbound", {
      p_bot_id: A,
      p_channel: "telegram",
      p_external_id: "again",
    });
    expect(second[0]?.claim_inbound).toBe(true);
  });

  it("количество в корзине сохраняется, повтор заявки не создаёт второй заказ", async () => {
    const saved = await saveProduct(svc(), {
      botId: A,
      title: "Файл",
      kind: "file",
      priceMinor: 1_000,
    });
    if (!saved.ok) throw new Error(saved.code);
    const first = await buyFromChannel(svc(), {
      botId: A,
      channel: "web",
      externalId: "cart",
      country: "KZ",
      productIds: [saved.value, saved.value],
      claimId: "web:cart:nonce",
      by: "test",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const total = await pg.query<{ t: string }>(
      "select total_minor::text t from v4.orders where id = $1",
      [first.orderId],
    );
    expect(Number(total.rows[0]!.t)).toBe(2_000);
    const second = await buyFromChannel(svc(), {
      botId: A,
      channel: "web",
      externalId: "cart",
      country: "KZ",
      productIds: [saved.value, saved.value],
      claimId: "web:cart:nonce",
      by: "test",
    });
    expect(second).toEqual({ ok: false, code: "duplicate" });
    const n = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.orders where bot_id = $1",
      [A],
    );
    expect(n.rows[0]!.n).toBe(1);
  });

  it("две позиции урока разные, ссылка на оплату держит отмену", async () => {
    const club = await saveProduct(svc(), {
      botId: A,
      title: "Клуб",
      kind: "club",
      priceMinor: 5_000,
    });
    if (!club.ok) throw new Error(club.code);
    const a = await svc().call("append_lesson", {
      p_bot_id: A,
      p_product_id: club.value,
      p_title: "Один",
    });
    const b = await svc().call("append_lesson", {
      p_bot_id: A,
      p_product_id: club.value,
      p_title: "Два",
    });
    expect(a[0]?.append_lesson).toBeTruthy();
    expect(b[0]?.append_lesson).not.toBe(a[0]?.append_lesson);
    const pos = await pg.query<{ p: number }>(
      `select position p from v4.lessons where product_id = $1 order by position`,
      [club.value],
    );
    expect(pos.rows.map((r) => r.p)).toEqual([1, 2]);
    const order = await buyFromChannel(svc(), {
      botId: A,
      channel: "web",
      externalId: "pupil",
      country: "KZ",
      productIds: [club.value],
      claimId: "web:pupil:1",
      by: "test",
    });
    if (!order.ok) throw new Error(order.code);
    const buyer = (
      await pg.query<{ buyer_id: string; no: string }>(
        "select buyer_id, no::text from v4.orders where id = $1",
        [order.orderId],
      )
    ).rows[0]!;
    await svc().call("issue_pay_link", {
      p_bot_id: A,
      p_order_id: order.orderId,
      p_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const held = await svc().call("cancel_by_buyer", {
      p_bot_id: A,
      p_buyer_id: buyer.buyer_id,
      p_order_no: Number(buyer.no),
    });
    expect(held[0]?.cancel_by_buyer).toBe("link_open");
    const status = await pg.query<{ status: string }>(
      "select status from v4.orders where id = $1",
      [order.orderId],
    );
    expect(status.rows[0]!.status).toBe("open");
  });

  it("отправка карточки одна, даже если канал ответил «неизвестно»", async () => {
    const calls: string[] = [];
    const message = outboundOf(
      {
        kind: "offer",
        buyerId: "b",
        offerId: "ABCDEFGH",
        currency: "KZT",
        totalMinor: 150_000,
        title: "Тетрадь",
      },
      "77",
      "ru",
    );
    await sendOnce(async (m) => {
      calls.push(m.buttons[0]?.data ?? "");
      return "unknown";
    }, message);
    expect(calls).toEqual(["offer:ABCDEFGH"]);
    expect(message?.text).toContain("1500.00 KZT");
  });

  it("чек без файла не садится с общим отпечатком", async () => {
    const saved = await saveProduct(svc(), {
      botId: A,
      title: "Ещё",
      kind: "file",
      priceMinor: 500,
    });
    if (!saved.ok) throw new Error(saved.code);
    await buyFromChannel(svc(), {
      botId: A,
      channel: "telegram",
      externalId: "55",
      country: "KZ",
      productIds: [saved.value],
      claimId: "tg:pay",
      by: "test",
    });
    const unread = await handleTelegramUpdate(svc(), {
      botId: A,
      update: { message: { chat: { id: 55 }, photo: [{ file_id: "x" }] } },
    });
    expect(unread).toEqual({ type: "refused", code: "receipt_unread" });
    const n = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.receipts where bot_id = $1 and fingerprint = $2",
      [A, "ab".repeat(32)],
    );
    expect(n.rows[0]!.n).toBe(0);
  });
});
