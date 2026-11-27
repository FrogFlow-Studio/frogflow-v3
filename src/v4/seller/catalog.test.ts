import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrder, recordPayment, submitReceipt } from "../core/money/money";
import { seedKopilka } from "../test/kopilka";
import { pgliteV4, v4Db } from "../test/pg";

/**
 * Карточка товара, поиск по основе слова и отмена покупателем (019) на каталоге
 * Копилки. Фразы — настоящие сообщения покупателей (проект, опыт 1.2: прежний
 * поиск находил 6 из 14).
 */
const K = "c0c0c0c0-0000-4000-8000-0000000004c1";
const X = "dddddddd-0000-4000-8000-0000000004d2";
let pg: PGlite;
let ids: Map<string, string>;
const asK = () => pgliteV4(pg, { botId: K });

const find = async (q: string) =>
  (await asK().call("find_products", { p_bot_id: K, p_query: q, p_limit: 8 })).map(
    (r) => `${String(r.title)}${r.variant_label ? ` · ${String(r.variant_label)}` : ""}`,
  );

async function buyer(bot = K) {
  return (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country) values ($1, 'KZ') returning id",
      [bot],
    )
  ).rows[0]!.id;
}

beforeAll(async () => {
  pg = await v4Db();
  ids = await seedKopilka(pg, K);
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [X]);
});
afterAll(() => pg.close());

describe("поиск по основе слова (ошибка 7 от 05.11)", () => {
  const cases: Array<[string, string]> = [
    ["Интересует папка классного руководителя", "Папка классного руководителя"],
    ["Интересуют лестницы", "Лестницы «Части речи и члены предложения»"],
    ["Интересует палитра средств выразительности", "Палитра средств выразительности"],
    ["Интересуют сборники формативного оценивания", "Формативное оценивание"],
    ["Интересует набор рефлексии для урока", "Рефлексия в национальном стиле"],
    ["Маған сынып жетекші папкасы керек", "Папка классного руководителя"],
    ["Документация (папка) МО ЕМН интересует", "Папка МО ЕМН"],
    ["небосвод", "Небосвод писателей"],
    ["родительские собрания 7 класс", "Папка родительских собраний · 7 класс"],
    ["формативка", "Формативное оценивание"],
    ["лестницу части речи", "Лестницы «Части речи и члены предложения»"],
    ["папку МО ОГН", "Папка МО ОГН"],
  ];
  for (const [q, want] of cases) {
    it(`«${q}» → ${want}`, async () => {
      const got = await find(q);
      expect(got[0], got.join(" | ")).toContain(want);
    });
  }

  it("«Хотела купить папку» — все папки, а не первая попавшаяся", async () => {
    const got = await find("Хотела купить папку");
    expect(got.filter((t) => t.startsWith("Папка")).length).toBeGreaterThanOrEqual(5);
  });

  it("слов нет совсем — весь каталог; нет совпадений — пусто", async () => {
    expect((await find("")).length).toBe(8);
    expect(await find("велосипед")).toEqual([]);
  });

  it("чужой магазин не видит каталог Копилки", async () => {
    const rows = await pgliteV4(pg, { botId: X }).call("find_products", {
      p_bot_id: K,
      p_query: "папка",
      p_limit: 8,
    });
    expect(rows).toEqual([]);
  });
});

describe("карточка товара", () => {
  it("описание, ключевые слова и цена для страны покупателя", async () => {
    const r = await asK().call("product_details", {
      p_bot_id: K,
      p_product_id: ids.get("Палитра средств выразительности"),
      p_country: "KZ",
    });
    expect(r[0]!.product_details).toMatchObject({
      title: "Палитра средств выразительности",
      description: expect.stringContaining("А4 или А3"),
      price: { currency: "KZT", amount_minor: 170000 },
      variants: [],
    });
  });

  it("у товара с вариантами — варианты с ценами; вариант наследует описание родителя", async () => {
    const parent = await asK().call("product_details", {
      p_bot_id: K,
      p_product_id: ids.get("Формативное оценивание: русский язык (Я1)"),
      p_country: "KZ",
    });
    const card = parent[0]!.product_details as {
      variants: Array<{ label: string; amount_minor: number }>;
    };
    expect(card.variants.find((v) => v.label === "5–11 классы")?.amount_minor).toBe(1650000);
    const v5 = await asK().call("product_details", {
      p_bot_id: K,
      p_product_id: ids.get("Формативное оценивание: русский язык (Я1) · 5 класс"),
      p_country: "KZ",
    });
    expect(v5[0]!.product_details).toMatchObject({
      title: "Формативное оценивание: русский язык (Я1) · 5 класс",
      description: expect.stringContaining("формативного"),
    });
  });

  it("архивный товар карточки не имеет", async () => {
    const t = (
      await pg.query<{ id: string }>(
        "insert into v4.products (bot_id, kind, title, base_price_minor, status, archived_at) values ($1, 'file', 'Старое', 100, 'archived', now()) returning id",
        [K],
      )
    ).rows[0]!.id;
    const r = await asK().call("product_details", {
      p_bot_id: K,
      p_product_id: t,
      p_country: "KZ",
    });
    expect(r[0]!.product_details).toBeNull();
  });
});

describe("отмена заказа покупателем (Д4)", () => {
  const order = async (b: string) => {
    const r = await createOrder(asK(), {
      botId: K,
      buyerId: b,
      country: "KZ",
      productIds: [ids.get("Небосвод писателей")!],
      by: "buyer",
    });
    if (!r.ok) throw new Error(r.code);
    return r.value;
  };
  const cancel = async (b: string, no: number) =>
    (await asK().call("cancel_by_buyer", { p_bot_id: K, p_buyer_id: b, p_order_no: no }))[0]!
      .cancel_by_buyer;

  it("свой открытый без денег — отменён один раз", async () => {
    const b = await buyer();
    const o = await order(b);
    expect(await cancel(b, o.no)).toBe("ok");
    expect(await cancel(b, o.no)).toBe("not_open");
  });

  it("чужой заказ — not_yours, заказ не тронут", async () => {
    const o = await order(await buyer());
    expect(await cancel(await buyer(), o.no)).toBe("not_yours");
    expect(await cancel(await buyer(), 999_999)).toBe("not_yours");
  });

  it("есть деньги — paid; чек на проверке — receipt_waiting", async () => {
    const b = await buyer();
    const paid = await order(b);
    const pay = await recordPayment(asK(), {
      botId: K,
      orderId: paid.id,
      amountMinor: 50000,
      currency: "KZT",
      method: "transfer",
      externalRef: "t-1",
      by: "seller",
    });
    expect(pay.ok).toBe(true);
    expect(await cancel(b, paid.no)).toBe("paid");
    const waiting = await order(b);
    const rc = await submitReceipt(asK(), {
      botId: K,
      orderId: waiting.id,
      storagePath: "receipts/x.jpg",
      fingerprint: "a".repeat(64),
    });
    expect(rc.ok).toBe(true);
    expect(await cancel(b, waiting.no)).toBe("receipt_waiting");
  });
});
