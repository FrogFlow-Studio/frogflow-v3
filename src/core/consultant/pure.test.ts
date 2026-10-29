import { describe, expect, it } from "vitest";
import { parseKnowledge, retrieveKnowledge, tokenize } from "./knowledge";
import { parseProfile } from "./profile";
import { buildSystemPrompt, cleanReply, isResetIntent } from "./prompt";

const docs = parseKnowledge(
  JSON.stringify([
    {
      title: "Доставка и оплата",
      content: "Курьер по Алматы 1500 ₸, Kaspi QR.",
      tags: ["доставка"],
    },
    { title: "Витамин D3", content: "60 капсул, 7500 ₸", category: "Витамины" },
    { title: "", content: "" },
    "мусор",
  ]),
);

describe("knowledge", () => {
  it("парсит документы и выкидывает пустые", () => {
    expect(docs).toHaveLength(2);
    expect(docs[0]!.id).toBe("doc1");
    expect(parseKnowledge("{oops")).toEqual([]);
  });
  it("отбирает по словам запроса, иначе даёт общие", () => {
    expect(tokenize("Сколько стоит доставка по Алматы?")).toEqual([
      "сколько",
      "стоит",
      "доставка",
      "алматы",
    ]);
    expect(retrieveKnowledge("доставка", docs, 1)[0]!.title).toBe("Доставка и оплата");
    expect(retrieveKnowledge("d3 витамин", docs, 1)[0]!.title).toBe("Витамин D3");
    expect(retrieveKnowledge("???", docs, 1)).toHaveLength(1);
  });
  it("находит статью по другому падежу слова (срез BOVI 28.10)", () => {
    const kb = parseKnowledge(
      JSON.stringify([
        { title: "Общие условия", content: "Работаем ежедневно." },
        { title: "Sander", tags: ["скатерти", "салфетки"], content: "Немецкий текстиль." },
        { title: "Traumina", tags: ["одеяла", "пух"], content: "Немецкие наполнители." },
      ]),
    );
    expect(retrieveKnowledge("скатерть", kb, 1)[0]!.title).toBe("Sander");
    expect(retrieveKnowledge("пуховое одеяло", kb, 1)[0]!.title).toBe("Traumina");
  });
});

describe("profile / prompt", () => {
  it("профиль по умолчанию и разбор с защитой от мусора", () => {
    const p = parseProfile(
      '{"brand_name":" Bloom ","goal":"nope","currency":"usd","countries":[]}',
      "Магазин",
    );
    expect(p.brand_name).toBe("Bloom");
    expect(p.goal).toBe("direct_sales");
    expect(p.currency).toBe("USD");
    expect(p.countries).toEqual(["KZ"]);
    expect(parseProfile(null, "Магазин").brand_name).toBe("Магазин");
  });
  it("промпт содержит роль, цель, каталог и базу знаний", () => {
    const s = buildSystemPrompt(parseProfile(null, "Bloom"), docs, "- Роза, 5000 KZT");
    expect(s).toContain("«Bloom»");
    expect(s).toContain("ГЛАВНАЯ ЦЕЛЬ — ПРОДАЖА");
    expect(s).toContain("КАТАЛОГ");
    expect(s).toContain("[ДОКУМЕНТ: Витамин D3");
  });
  it("магазин в переписке: покупку оформляет бот, а не заявка менеджеру", () => {
    const profile = parseProfile(null, "Bloom");
    const plain = buildSystemPrompt(profile, docs, "- Роза, 5000 KZT");
    expect(plain).toContain("record_order_lead и передайте менеджеру");
    const shop = buildSystemPrompt(profile, docs, "- Роза, 5000 KZT", { shopInChat: true });
    expect(shop).toContain("ГЛАВНАЯ ЦЕЛЬ — ПРОДАЖА");
    expect(shop).toContain("Заказ в этом чате оформляет бот магазина");
    expect(shop).toContain("Телефон и адрес не спрашивайте");
    expect(shop).not.toContain("record_order_lead и передайте менеджеру");
    // Другие цели (запись, созвон) магазин в переписке не меняет.
    const booking = buildSystemPrompt({ ...profile, goal: "booking" }, docs, "", {
      shopInChat: true,
    });
    expect(booking).toContain("ГЛАВНАЯ ЦЕЛЬ — ЗАПИСЬ");
  });
  it("WhatsApp: не навязывает Kaspi и повторный заказ, прочие каналы не получают этот блок", () => {
    const profile = parseProfile(null, "Bloom");
    const whatsapp = buildSystemPrompt(profile, docs, "- Роза, 5000 KZT", {
      shopInChat: true,
      platform: "whatsapp",
    });
    expect(whatsapp).toContain("WHATSAPP: ПРАВИЛА БЕЗ НАВЯЗЧИВЫХ ПРОДАЖ");
    expect(whatsapp).toContain("не добавляйте автоматически");
    expect(whatsapp).toContain("не создавайте новый заказ");
    const instagram = buildSystemPrompt(profile, docs, "- Роза, 5000 KZT", {
      shopInChat: true,
      platform: "instagram",
    });
    expect(instagram).not.toContain("WHATSAPP: ПРАВИЛА БЕЗ НАВЯЗЧИВЫХ ПРОДАЖ");
  });
  it("сценарий продавца v2: один блок продажи вместо трёх, только с кнопкой «Купить»", () => {
    const profile = parseProfile(null, "Bloom");
    const opts = { shopInChat: true, buyButton: true, platform: "whatsapp" } as const;
    const v2 = buildSystemPrompt(profile, docs, "- Роза, 5000 KZT", { ...opts, playbook: "v2" });
    expect(v2).toContain("ГЛАВНАЯ ЦЕЛЬ — ПРОДАЖА В ПЕРЕПИСКЕ");
    expect(v2).toContain("offer_buy_button");
    expect(v2).toContain("get_my_order_status");
    expect(v2).not.toContain("WHATSAPP: ПРАВИЛА БЕЗ НАВЯЗЧИВЫХ ПРОДАЖ");
    expect(v2).not.toContain("КНОПКА «КУПИТЬ»\n");
    expect(v2).not.toContain("РАБОТА С ВОЗРАЖЕНИЯМИ");
    // Без кнопки «Купить» сценарий v2 не включается: он на неё опирается.
    const noButton = buildSystemPrompt(profile, docs, "- Роза, 5000 KZT", {
      ...opts,
      buyButton: false,
      playbook: "v2",
    });
    expect(noButton).not.toContain("ПРОДАЖА В ПЕРЕПИСКЕ");
    expect(noButton).toContain("Заказ в этом чате оформляет бот магазина");
    const old = buildSystemPrompt(profile, docs, "- Роза, 5000 KZT", opts);
    expect(old).not.toContain("ПРОДАЖА В ПЕРЕПИСКЕ");
  });
  it("чистит markdown и сценарии", () => {
    expect(cleanReply("**Да**, есть.\nКлиент: беру\nАссистент: ок\n\n\n\n_итого_ 5")).toBe(
      "Да, есть.\n\nитого 5",
    );
    expect(isResetIntent("/reset")).toBe(true);
    expect(isResetIntent("сброс")).toBe(true);
    expect(isResetIntent("хочу сброс цены")).toBe(false);
  });
});
