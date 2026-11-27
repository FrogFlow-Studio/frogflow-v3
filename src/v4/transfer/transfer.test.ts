import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConsultantProfile } from "@/core/consultant/profile";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { sellerContext } from "../seller/role";
import { seedKopilka } from "../test/kopilka";
import { pgliteV4, v4Db } from "../test/pg";
import { applyTransfer } from "./apply";
import { HISTORY_PER_BUYER, planTransfer, type V3Snapshot } from "./plan";
import { readV3Snapshot } from "./read-v3.server";

/**
 * Перенос v3 → v4 (Спецификация, раздел 3): каждое поле либо переносится,
 * либо в отчёте с причиной; повторный запуск ничего не задваивает. Снимок v3 —
 * как у Копилки (анкета, знания 26.10 в сокращении, флажки, остаток, история).
 */
const K = "c0c0c0c0-0000-4000-8000-00000000f001";
let pg: PGlite;
let ids: Map<string, string>;

const profile: ConsultantProfile = {
  brand_name: "Копилка Русоведа",
  goal: "direct_sales",
  tone: "friendly_expert",
  primary_language: "ru",
  countries: ["KZ", "RU"],
  currency: "KZT",
  website_url: "https://kopilka.example",
  payment_info: "Kaspi-перевод, после проверки чека — файл.",
  delivery_info: "Файл приходит в этот чат.",
  about: "Материалы для учителей русского языка.",
  custom_instructions:
    "Пиши тепло, на «вы».\nВсегда спрашивай страну первым.\nСкидка 10% постоянным.",
};

function snapshot(over: Partial<V3Snapshot> = {}): V3Snapshot {
  return {
    profile,
    knowledge: [
      {
        id: "k1",
        title: "Палитра средств выразительности",
        content: "Печать на А4 или А3.",
        tags: ["тропы"],
      },
      { id: "k2", title: "Форматы", category: "общее", content: "Все материалы в Word и PDF." },
      { id: "k3", title: "Контакты", content: "Пишите Кристине: +7 701 555 12 34" },
      { id: "k4", title: "Папка", content: "Папки бывают разные." },
    ],
    settings: {
      consultant_enabled: "true",
      country_ai: "true",
      country_ai_daily_usd: "0.2",
      postpay_ai: "false",
      chat_skip_chatter: "false",
    },
    balanceUsd: 3.4567891,
    products: [...ids.entries()].map(([title, id]) => ({
      id,
      title: title.split(" · ")[0]!,
      variantLabel: title.includes(" · ") ? title.split(" · ")[1]! : null,
      description: null,
      keywords: [],
    })),
    histories: [
      {
        telegramId: "777",
        recent: Array.from({ length: 30 }, (_, i) => ({
          role: i % 2 ? ("assistant" as const) : ("customer" as const),
          text: `реплика ${i}`,
        })),
      },
      { telegramId: "999", recent: [{ role: "customer", text: "нет в v4" }] },
    ],
    blockedTelegramIds: ["888"],
    v3Products: [
      {
        id: ids.get("Палитра средств выразительности")!,
        description: null,
        keywords: ["палитра"],
        photos: ["bot/pal-1.jpg", "bot/pal-2.jpg"],
      },
      {
        id: "c0c0c0c0-0000-4000-8000-00000000dead",
        description: "Товара нет в v4",
        keywords: [],
        photos: [],
      },
    ],
    ...over,
  };
}

async function buyerWithTelegram(tg: string) {
  const b = (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country) values ($1, 'KZ') returning id",
      [K],
    )
  ).rows[0]!.id;
  await pg.query(
    "insert into v4.buyer_channels (bot_id, channel, external_id, buyer_id) values ($1, 'telegram', $2, $3)",
    [K, tg, b],
  );
  return b;
}

beforeAll(async () => {
  pg = await v4Db();
  ids = await seedKopilka(pg, K);
  // Карточки Копилки уже с описаниями — для переноса палитру делаем пустой.
  await pg.query(
    "update v4.products set description = null where bot_id = $1 and title = 'Палитра средств выразительности'",
    [K],
  );
}, 60_000);
afterAll(() => pg.close());

describe("план переноса", () => {
  it("анкета: поля как есть, тон словами, сайт в «о магазине», спорные указания — в отчёт", () => {
    const p = planTransfer(snapshot());
    expect(p.profile).toMatchObject({
      shop_name: "Копилка Русоведа",
      payment_terms: "Kaspi-перевод, после проверки чека — файл.",
      delivery_terms: "Файл приходит в этот чат.",
      tone: "дружелюбный эксперт",
    });
    expect(p.profile.about).toContain("Сайт: https://kopilka.example");
    expect(p.profile.about).toContain("Пиши тепло");
    expect(p.profile.about).not.toContain("страну");
    expect(p.profile.about).not.toContain("Скидка");
    expect(
      p.report.filter((r) => r.area === "анкета" && r.item.startsWith("указание")),
    ).toHaveLength(2);
    expect(p.report.some((r) => r.item.startsWith("страны KZ, RU"))).toBe(true);
  });

  it("знания: статья про один товар — в карточку, общая — в знания, с телефоном или про несколько — на проверке", () => {
    const p = planTransfer(snapshot());
    const pal = p.productTexts.find(
      (t) => t.productId === ids.get("Палитра средств выразительности"),
    );
    expect(pal).toEqual({
      productId: pal!.productId,
      description: "Печать на А4 или А3.",
      keywords: ["палитра", "тропы"],
      photos: ["bot/pal-1.jpg", "bot/pal-2.jpg"],
    });
    expect(p.knowledge.find((k) => k.question === "Форматы")).toMatchObject({ needsReview: false });
    expect(p.knowledge.find((k) => k.question === "Контакты")).toMatchObject({ needsReview: true });
    expect(p.report.some((r) => r.item.includes("Контакты"))).toBe(true);
  });

  it("карточка v3: описание товара важнее статьи, статья тогда — в знания; товара нет в v4 — в отчёт", () => {
    const palId = ids.get("Палитра средств выразительности")!;
    const p = planTransfer(
      snapshot({
        v3Products: [
          { id: palId, description: "Описание из карточки v3.", keywords: [], photos: [] },
          { id: "c0c0c0c0-0000-4000-8000-00000000dead", description: "x", keywords: [], photos: [] },
        ],
      }),
    );
    expect(p.productTexts.find((t) => t.productId === palId)?.description).toBe(
      "Описание из карточки v3.",
    );
    expect(p.knowledge.find((k) => k.question === "Палитра средств выразительности")).toMatchObject({
      answer: "Печать на А4 или А3.",
    });
    expect(p.report.some((r) => r.area === "товары" && r.item.startsWith("1 товаров"))).toBe(true);
  });

  it("H05 background-ai-flags-kept: в v3 включена только «страна» — в v4 только «страна»", () => {
    const p = planTransfer(
      snapshot({
        settings: { country_ai: "true", country_ai_daily_usd: "0.2", postpay_ai: "false" },
      }),
    );
    expect(p.features).toEqual({
      buyer: false,
      triage: false,
      country: true,
      country_daily_usd: 0.2,
      postpay: false,
    });
  });

  it("история — последние 24 на покупателя; анкеты нет — строка отчёта", () => {
    const p = planTransfer(snapshot({ profile: null }));
    expect(p.histories[0]!.messages).toHaveLength(HISTORY_PER_BUYER);
    expect(p.histories[0]!.messages.at(-1)!.text).toBe("реплика 29");
    expect(p.report.some((r) => r.area === "анкета" && r.reason.includes("не заполнена"))).toBe(
      true,
    );
  });
});

describe("запись в v4", () => {
  it("всё на месте, повторный запуск ничего не задваивает", async () => {
    const b777 = await buyerWithTelegram("777");
    const b888 = await buyerWithTelegram("888");
    const svc = pgliteV4(pg);
    const plan = planTransfer(snapshot());
    const r1 = await applyTransfer(svc, K, plan, { withBalance: true, by: "operator" });
    expect(r1).toMatchObject({ histories: 1, blocked: 1, balanceMicroUsd: 3_456_789 });
    expect(r1.report.some((x) => x.area === "история" && x.item.startsWith("1 покупателей"))).toBe(
      true,
    );

    const r2 = await applyTransfer(svc, K, plan, { withBalance: true, by: "operator" });
    expect(r2).toMatchObject({
      knowledge: 0,
      histories: 0,
      blocked: 0,
      balanceMicroUsd: 3_456_789,
    });
    expect(
      Number(
        (
          await pg.query<{ b: string }>(
            "select balance_micro_usd b from v4.ai_wallet where bot_id = $1",
            [K],
          )
        ).rows[0]!.b,
      ),
    ).toBe(3_456_789);
    expect(
      Number(
        (
          await pg.query<{ c: string }>(
            "select count(*) c from v4.messages where buyer_id = $1 and source = 'v3'",
            [b777],
          )
        ).rows[0]!.c,
      ),
    ).toBe(24);
    expect(
      (await pg.query<{ by: string }>("select blocked_by by from v4.buyers where id = $1", [b888]))
        .rows[0]!.by,
    ).toBe("v3");

    const c = await sellerContext(pgliteV4(pg, { botId: K }), { botId: K, buyerId: b777 });
    expect(c.features).toMatchObject({ buyer: true, country: true, country_daily_usd: 0.2 });
    expect(c.knowledge.map((k) => k.question)).toContain("Форматы");
    expect(c.knowledge.map((k) => k.question)).not.toContain("Контакты"); // на проверке
    const pal = await pg.query<{ d: string }>(
      "select description d from v4.products where id = $1",
      [ids.get("Палитра средств выразительности")],
    );
    expect(pal.rows[0]!.d).toBe("Печать на А4 или А3.");
    const ph = await pg.query<{ ph: string[] }>(
      "select photo_paths ph from v4.products where id = $1",
      [ids.get("Палитра средств выразительности")],
    );
    expect(ph.rows[0]!.ph).toEqual(["bot/pal-1.jpg", "bot/pal-2.jpg"]);
  });

  it("без остатка до переключения — остаток в отчёте", async () => {
    const r = await applyTransfer(pgliteV4(pg), K, planTransfer(snapshot()), {
      withBalance: false,
      by: "operator",
    });
    expect(r.balanceMicroUsd).toBeNull();
    expect(r.report.some((x) => x.area === "кошелёк")).toBe(true);
  });

  it("арендатор перенос запустить не может", async () => {
    await expect(
      applyTransfer(pgliteV4(pg, { botId: K }), K, planTransfer(snapshot()), {
        withBalance: false,
        by: "x",
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("чтение v3", () => {
  it("анкета, знания, флажки, остаток, история и блоки — постранично, ошибка чтения — сбой", async () => {
    const db = fakeDb({ maxRows: 1000 });
    db.tables.app_settings = [
      { bot_id: K, key: "consultant_profile", value: JSON.stringify(profile) },
      { bot_id: K, key: "consultant_knowledge", value: JSON.stringify(snapshot().knowledge) },
      { bot_id: K, key: "consultant_enabled", value: "true" },
      { bot_id: K, key: "chat_skip_chatter", value: "false" },
      {
        bot_id: K,
        key: "ai_balance",
        value: JSON.stringify({ usd: 1.25, low: false, empty: false }),
      },
      { bot_id: K, key: "shop_tagline", value: "не нужно" },
    ];
    db.tables.bot_users = Array.from({ length: 1500 }, (_, i) => ({
      bot_id: K,
      user_key: `tg:${i + 1}`,
      telegram_id: i + 1,
      state:
        i === 1499 ? { consultant: { recent: [{ role: "customer", text: "последний" }] } } : {},
    }));
    db.tables.products = [
      { bot_id: K, id: "p1", description: "Описание", keywords: ["к1"] },
      { bot_id: K, id: "p2", description: null, keywords: [] },
    ];
    db.tables.product_images = [
      { bot_id: K, id: "i2", product_id: "p1", image_path: "b/2.jpg", sort_order: 2 },
      { bot_id: K, id: "i1", product_id: "p1", image_path: "b/1.jpg", sort_order: 1 },
    ];
    db.tables.blocked_users = [{ bot_id: K, telegram_id: 42, blocked_at: "2026-11-01T00:00:00Z" }];
    const ctx = { db, tenant: { id: K } } as unknown as TenantContext;
    const s = await readV3Snapshot(ctx, pgliteV4(pg));
    expect(s.profile?.brand_name).toBe("Копилка Русоведа");
    expect(s.knowledge).toHaveLength(4);
    expect(s.settings).toEqual({
      consultant_profile: expect.any(String),
      consultant_knowledge: expect.any(String),
      consultant_enabled: "true",
      chat_skip_chatter: "false",
      ai_balance: expect.any(String),
    });
    expect(s.balanceUsd).toBe(1.25);
    expect(s.histories).toEqual([
      { telegramId: "1500", recent: [{ role: "customer", text: "последний" }] },
    ]);
    expect(s.blockedTelegramIds).toEqual(["42"]);
    expect(s.v3Products).toEqual([
      { id: "p1", description: "Описание", keywords: ["к1"], photos: ["b/1.jpg", "b/2.jpg"] },
      { id: "p2", description: null, keywords: [], photos: [] },
    ]);
    expect(s.products.length).toBe(ids.size);
  });
});
