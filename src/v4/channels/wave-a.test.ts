import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parkedAgentModel, scriptedAgentModel } from "../agent/model";
import { openCase } from "../core/cases/cases";
import { saveProduct } from "../core/platform";
import { pgliteV4, v4Db } from "../test/pg";
import { adaptComment, adaptDirect, adaptTelegram, marketingOpen, zernioIntent } from "./adapt";
import { buyFromChannel } from "./buyer";

const A = "bbbbbbbb-0000-4000-8000-0000000000b2";

let pg: PGlite;
let productId = "";
const svc = () => pgliteV4(pg);

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
  const saved = await saveProduct(svc(), {
    botId: A,
    title: "Тетрадь",
    kind: "file",
    priceMinor: 100_000,
    description: "5 класс",
  });
  if (!saved.ok) throw new Error(saved.code);
  productId = saved.value;
}, 60_000);
afterAll(async () => pg.close());

describe("тонкий адаптер без живой модели", () => {
  it("текст без флажка ИИ — кнопки, модель не зовётся; покупка одна на заявку", async () => {
    const model = scriptedAgentModel([{ text: "не должны сюда" }]);
    const text = await adaptTelegram(svc(), {
      botId: A,
      claimId: "tg:1",
      model,
      update: { message: { chat: { id: 77 }, text: "привет" } },
    });
    expect(text.kind).toBe("buttons");
    expect(model.requests).toHaveLength(0);

    const bought = await adaptTelegram(svc(), {
      botId: A,
      claimId: "tg:2",
      model,
      country: "KZ",
      update: {
        callback_query: { data: `buy:${productId}`, message: { chat: { id: 77 } } },
      },
    });
    expect(bought.kind).toBe("offer");
    if (bought.kind !== "offer") return;
    expect(bought.totalMinor).toBe(100_000);
    expect(bought.currency).toBe("KZT");
    expect(bought.title).toBe("Тетрадь");
    const locked = await pg.query<{ hours: number }>(
      `select round(extract(epoch from (expires_at - created_at)) / 3600)::int as hours
         from v4.offers where id = $1`,
      [bought.offerId],
    );
    expect(locked.rows[0]!.hours).toBe(72);
    const again = await adaptTelegram(svc(), {
      botId: A,
      claimId: "tg:2",
      model,
      country: "KZ",
      update: {
        callback_query: { data: `buy:${productId}`, message: { chat: { id: 77 } } },
      },
    });
    expect(again).toEqual({ kind: "duplicate" });
    const presses = [];
    for (let i = 0; i < 8; i++) {
      presses.push(
        await adaptTelegram(svc(), {
          botId: A,
          claimId: `tg:buy:${i}`,
          model,
          country: "KZ",
          update: {
            callback_query: {
              data: `offer:${bought.offerId}`,
              message: { chat: { id: 77 } },
            },
          },
        }),
      );
    }
    expect(presses[0]).toMatchObject({ kind: "order", reused: false });
    expect(presses.slice(1).every((p) => p.kind === "order" && p.reused)).toBe(true);
    const ids = new Set(presses.map((p) => (p.kind === "order" ? p.orderId : "")));
    expect(ids.size).toBe(1);
    const n = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.orders where bot_id = $1",
      [A],
    );
    expect(n.rows[0]!.n).toBe(1);
    expect(model.requests).toHaveLength(0);
  });

  it("чек открывает дело продавцу и не подтверждает оплату", async () => {
    const receipt = await adaptTelegram(svc(), {
      botId: A,
      claimId: "tg:3",
      model: parkedAgentModel,
      update: { message: { chat: { id: 77 }, photo: [{ file_id: "ph" }] } },
    });
    expect(receipt.kind).toBe("receipt");
    const cases = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.cases where bot_id = $1 and kind = 'receipt_review' and status = 'open'",
      [A],
    );
    expect(cases.rows[0]!.n).toBe(1);
    const due = await pg.query<{ due: string }>(
      "select due_minor::text due from v4.order_money where bot_id = $1",
      [A],
    );
    expect(Number(due.rows[0]!.due)).toBeGreaterThan(0);
  });

  it("включённый ИИ с припаркованной моделью молчит и не входит в прогон", async () => {
    await pg.query(`update v4.shops set ai_features = '{"buyer": true}'::jsonb where bot_id = $1`, [
      A,
    ]);
    const parked = await adaptTelegram(svc(), {
      botId: A,
      claimId: "tg:4",
      model: parkedAgentModel,
      update: { message: { chat: { id: 77 }, text: "есть синяя?" } },
    });
    expect(parked).toEqual({ kind: "silent", reason: "model_parked" });
  });

  it("записанная модель вызывается, когда флажок включён", async () => {
    await pg.query("select v4.ai_credit($1, 'topup', 5000000, 'тест', 'operator')", [A]);
    const model = scriptedAgentModel([{ text: "Здравствуйте! Тетрадь есть." }]);
    try {
      const reply = await adaptTelegram(svc(), {
        botId: A,
        claimId: "tg:5",
        model,
        mode: "test",
        update: { message: { chat: { id: 88 }, text: "здравствуйте" } },
      });
      expect(model.requests.length).toBeGreaterThan(0);
      expect(reply.kind === "reply" || reply.kind === "silent").toBe(true);
    } finally {
      await pg.query(
        `update v4.shops set ai_features = '{"buyer": false}'::jsonb where bot_id = $1`,
        [A],
      );
    }
  });

  it("ответ продавца из Telegram пишется один раз и модель не зовётся", async () => {
    const opened = await openCase(svc(), {
      botId: A,
      kind: "handoff",
      dedupeKey: "hand-1",
      by: "test",
    });
    if (!opened.ok) throw new Error(opened.code);
    const model = scriptedAgentModel([{ text: "нет" }]);
    const wrote = await adaptTelegram(svc(), {
      botId: A,
      claimId: "tg:6",
      model,
      update: {
        message: { chat: { id: 1 }, text: `reply:${opened.value.caseId} Файл уже в чате` },
      },
    });
    expect(wrote).toEqual({ kind: "seller_reply", wrote: true });
    const second = await adaptTelegram(svc(), {
      botId: A,
      claimId: "tg:7",
      model,
      update: {
        message: { chat: { id: 1 }, text: `reply:${opened.value.caseId} Ещё раз` },
      },
    });
    expect(second).toEqual({ kind: "seller_reply", wrote: false });
    expect(model.requests).toHaveLength(0);
  });

  it("комментарий Instagram пишется в v4 и не зовёт модель", async () => {
    const intent = zernioIntent({
      id: "c1",
      event: "comment.received",
      post: { id: "post-1" },
      comment: { id: "c1", text: "хочу", author: { id: "ig-1", username: "anya" } },
    });
    expect(intent.type).toBe("comment");
    if (intent.type !== "comment") return;
    const row = await adaptComment(svc(), {
      botId: A,
      claimId: "c1",
      externalId: intent.externalId,
      postId: intent.postId,
      commenterId: intent.commenterId,
      text: intent.text,
      commentedAt: new Date("2026-11-01T00:00:00Z"),
    });
    expect(row.kind).toBe("comment");
  });
});

describe("один товар из трёх каналов", () => {
  it("Telegram, сайт и Direct создают по заказу, повтор заявки — нет", async () => {
    const channels = ["telegram", "web", "instagram"] as const;
    for (const channel of channels) {
      const bought = await buyFromChannel(svc(), {
        botId: A,
        channel,
        externalId: `${channel}-buyer`,
        country: "KZ",
        productIds: [productId],
        claimId: `${channel}:buy:1`,
        by: channel,
      });
      expect(bought.ok, channel).toBe(true);
    }
    const again = await buyFromChannel(svc(), {
      botId: A,
      channel: "web",
      externalId: "web-buyer",
      country: "KZ",
      productIds: [productId],
      claimId: "web:buy:1",
      by: "web",
    });
    expect(again).toEqual({ ok: false, code: "duplicate" });
    const n = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.orders where bot_id = $1",
      [A],
    );
    expect(n.rows[0]!.n).toBe(4);
  });

  it("WhatsApp вне 24 часов закрыт для маркетинга, внутри окна открыт", async () => {
    const then = new Date("2026-11-01T00:00:00Z");
    await adaptDirect(svc(), {
      botId: A,
      channel: "whatsapp",
      claimId: "wa:hi",
      externalId: "wa-9",
      text: "привет",
      model: parkedAgentModel,
      country: "KZ",
    });
    await pg.query(
      `update v4.buyer_channels set last_inbound_at = $2
        where bot_id = $1 and channel = 'whatsapp' and external_id = 'wa-9'`,
      [A, then.toISOString()],
    );
    expect(
      await marketingOpen(svc(), {
        botId: A,
        channel: "whatsapp",
        externalId: "wa-9",
        now: new Date("2026-11-02T01:00:00Z"),
      }),
    ).toBe(false);
    expect(
      await marketingOpen(svc(), {
        botId: A,
        channel: "whatsapp",
        externalId: "wa-9",
        now: new Date("2026-11-01T01:00:00Z"),
      }),
    ).toBe(true);
    expect(
      await marketingOpen(svc(), {
        botId: A,
        channel: "instagram",
        externalId: "ig-never",
        now: new Date("2026-11-02T01:00:00Z"),
      }),
    ).toBe(true);
  });
});
