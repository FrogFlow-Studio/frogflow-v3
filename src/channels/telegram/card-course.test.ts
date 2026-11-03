import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Product } from "@/core/catalog/catalog";
import { courseKey } from "@/core/courses/course";
import { COURSE_MARKER_URL } from "@/core/courses/marker";
import { productCard } from "./screens";

/** Карточка курса в боте, когда курс проходят в чате (Lash Academy, 03.11.2026). */
const BOT = "00000000-0000-0000-0000-0000000000c6";
const P = "00000000-0000-4000-8000-0000000000a1";
const product = {
  id: P,
  name: "Онлайн-курс по наращиванию ресниц",
  description: "С нуля до первой клиентки",
  price: 10000,
  currency: "KGS",
  country_prices: {},
  fulfillment_kind: "digital",
  file_url: COURSE_MARKER_URL,
  stock_quantity: null,
  category_ids: [],
  product_images: [],
  product_variants: [],
} as unknown as Product;
const lesson = (n: number, title: string) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  title,
  text: "Текст",
  files: [],
  link: "https://youtu.be/x" + n,
});

function ctx(inBot: boolean) {
  const db = fakeDb();
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: courseKey(P),
      value: JSON.stringify({
        schedule: { mode: "all" },
        lessons: [
          lesson(1, "Модуль 1 · 1.1. Знакомство"),
          lesson(2, "Модуль 1 · 1.2. Материалы"),
          lesson(3, "Модуль 2 · 2.1. Изоляция"),
        ],
      }),
    },
  ];
  db.tables.order_items = [];
  return {
    tenant: {
      id: BOT,
      modules: { courses: true },
      settings: { served_by: "v2", ...(inBot ? { delivery: { course_in_bot: true } } : {}) },
    },
    db,
    timezone: "Asia/Bishkek",
  } as unknown as TenantContext;
}

const callbacks = (k: { inline_keyboard?: Array<Array<{ text: string }>> }) =>
  (k.inline_keyboard ?? [])
    .flat()
    .map((b) => [b.text, (b as { callback_data?: string }).callback_data]);

describe("карточка курса в боте", () => {
  it("курс в боте: 🎓, программа по модулям, «Купить курс» ведёт сразу в корзину", async () => {
    const card = await productCard(ctx(true), product, "ru", null);
    expect(card.caption.startsWith("🎓 <b>Онлайн-курс по наращиванию ресниц</b>")).toBe(true);
    expect(card.caption).toContain(
      "📚 <b>Программа · 3 урока</b>\n<b>Модуль 1</b>\n   1.1. Знакомство\n   1.2. Материалы\n<b>Модуль 2</b>\n   2.1. Изоляция",
    );
    expect(card.caption).toContain("📲 Уроки приходят прямо в этот чат");
    expect(callbacks(card.keyboard)).toContainEqual(["🎓 Купить курс", `add:${P}::c`]);
  });

  it("выключено — карточка как раньше", async () => {
    const card = await productCard(ctx(false), product, "ru", null);
    expect(card.caption.startsWith("📦 ")).toBe(true);
    expect(card.caption).toContain("🎓 Уроков в курсе: 3");
    expect(callbacks(card.keyboard)).toContainEqual(["➕ Добавить в корзину", `add:${P}`]);
  });
});
