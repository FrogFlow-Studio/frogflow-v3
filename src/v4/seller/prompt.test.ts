import { describe, expect, it } from "vitest";
import { buildSellerSystem } from "./prompt";
import { SELLER_TOOLS } from "./tools";

/**
 * Снимок промпта продавца: правка правил, порядка блоков или описания
 * инструментов видна в PR построчно (файл __snapshots__/seller-prompt.txt).
 * Обновить снимок — `npx vitest run src/v4/seller/prompt.test.ts -u`, и
 * объяснить изменение в описании PR.
 */
describe("снимок промпта продавца", () => {
  it("4 блока и инструменты для анкеты Копилки", async () => {
    const system = buildSellerSystem({
      profile: {
        shop_name: "Копилка Русоведа",
        about: "Материалы для учителей русского языка.",
        payment_terms: "Kaspi-перевод, после проверки чека — файл.",
        delivery_terms: "Файл приходит в этот чат.",
        tone: "дружелюбный эксперт",
        advantages: "Сделано учителем, проверено на уроках.",
        voice_examples: "Добрый день! Папка подойдёт для 5 класса.",
        work_hours_note: "Продавец отвечает с 9:00 до 21:00.",
      },
      knowledge: [{ id: "k1", question: "Какой формат?", answer: "Word и PDF." }],
      knowledgeTotal: 40,
      features: { objections: true, upsell: true },
      buyer: {
        country: "KZ",
        facts: { grade: "5" },
        openOrders: [],
        localTime: "10:00",
        weekday: 3,
        context: "Пост про палитру",
        voice: true,
      },
      lang: "ru",
    });
    expect(system.map((b) => b.cache)).toEqual([true, true, false, false]);
    const text = [
      ...system.map(
        (b, i) => `===== блок ${i + 1} (кэш: ${b.cache ? "да" : "нет"}) =====\n${b.text}`,
      ),
      "===== инструменты =====",
      ...SELLER_TOOLS.map(
        (t) => `${t.name}: ${t.description ?? ""}\n${JSON.stringify(t.input_schema)}`,
      ),
    ].join("\n\n");
    await expect(text).toMatchFileSnapshot("__snapshots__/seller-prompt.txt");
  });
});
