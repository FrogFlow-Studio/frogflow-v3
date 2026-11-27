import { describe, expect, it } from "vitest";
import { type CheckContext, checkReply, findNumbers, knownAmounts } from "./checks";

/**
 * Проверка ответа (Спецификация, раздел 4): на каждое правило — «пропускает
 * правильное» и «ловит неправильное». Каталог — Копилка (как в экзамене).
 */
const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  lang: "ru",
  prices: [2000, 1700, 1500, 3500, 2500, 10000, 16500, 17500],
  allowedNumbers: [],
  shopText:
    "Kaspi-перевод по реквизитам с чеком. Файл приходит в этот чат после подтверждения чека. Формат А4 и А3.",
  deliveryTerms: "Файл приходит в этот чат в течение 15 минут после подтверждения чека.",
  quoted: ["Палитра средств выразительности", "Папка классного руководителя"],
  allowedContacts: ["Kaspi Gold 4400 0000 0000 0000", "https://kopilka.kz"],
  toolNames: ["find_products", "product_card", "offer", "hand_to_seller", "payment_methods"],
  offerShown: true,
  recentReplies: [],
  ...over,
});

describe("числа и известные суммы", () => {
  it("«1 700 ₸», «2.500», телефон и год различаются", () => {
    const n = findNumbers("Палитра 1 700 ₸, комплект 2.500, звоните +7 701 123 45 67, в 2026 году");
    expect(n.map((x) => [x.value, x.money, x.phone])).toEqual([
      [1700, true, false],
      [2500, true, false],
      [77011234567, false, true],
      [2026, false, false],
    ]);
  });

  it("суммы 2–3 цен и цена × 3 известны", () => {
    const k = knownAmounts([2000, 2500], []);
    expect([2000, 4000, 4500, 7500, 6000, 6500].every((x) => k.has(x))).toBe(true);
    expect(k.has(25000)).toBe(false);
  });
});

describe("правила проверки", () => {
  it("правильный ответ проходит", () => {
    expect(
      checkReply(
        "Палитра средств выразительности — 1 700 ₸, печатается на А4 и А3. Кнопка ниже 👇",
        ctx(),
      ),
    ).toBeNull();
  });

  it("1. цена не из каталога — price_unknown; 5-6-7 класс = 7 500 — известна", () => {
    expect(checkReply("Папка стоит 25 000 ₸", ctx())?.code).toBe("price_unknown");
    expect(checkReply("Стоимость 1200 тенге", ctx())?.code).toBe("price_unknown");
    expect(checkReply("За три класса — 7 500 ₸", ctx({ prices: [2500] }))).toBeNull();
    expect(checkReply("Скидка на 3 класса", ctx())?.code).not.toBe("price_unknown");
  });

  it("2. срок доставки не из анкеты — shipping_unknown", () => {
    expect(checkReply("Доставка займёт 3 дня.", ctx())?.code).toBe("shipping_unknown");
    expect(checkReply("Доставка — в течение 15 минут после чека.", ctx())).toBeNull();
  });

  it("3. язык: казахский вопрос — русский ответ ловится, названия товаров не мешают", () => {
    const kk = ctx({ lang: "kk" });
    expect(checkReply("Нажмите кнопку ниже, чтобы оформить покупку папки 🙂", kk)?.code).toBe(
      "wrong_language",
    );
    expect(
      checkReply("Папка классного руководителя — 3 500 ₸. Төмендегі батырманы басыңыз 🙂", kk),
    ).toBeNull();
    const en = ctx({ lang: "en" });
    expect(checkReply("Palitra «Палитра средств выразительности» costs 1 700 ₸.", en)).toBeNull();
    expect(checkReply("Это стоит 1 700 ₸, кнопка ниже", en)?.code).toBe("wrong_language");
    const uz = ctx({ lang: "uz" });
    expect(checkReply("Narxi 1 700 ₸. Quyidagi tugmani bosing.", uz)).toBeNull();
    expect(checkReply("Нархи 1 700 ₸. Қуйидаги тугмани босинг.", uz)?.code).toBe("wrong_language");
  });

  it("4. длиннее предела — too_long; предел продавца учитывается", () => {
    expect(checkReply("а".repeat(601), ctx())?.code).toBe("too_long");
    expect(
      checkReply("Готово, кнопка ниже. ".repeat(20).trim(), ctx({ maxChars: 300 }))?.code,
    ).toBe("too_long");
  });

  it("5. скидка, подарок, бесплатно — только если есть в текстах магазина", () => {
    expect(checkReply("Дам скидку, если возьмёте два", ctx())?.code).toBe("promise");
    expect(checkReply("Доставка бесплатная", ctx())?.code).toBe("promise");
    expect(checkReply("Сыйлық емес, бірақ тегін жеткіземіз", ctx({ lang: "kk" }))?.code).toBe(
      "promise",
    );
    expect(
      checkReply(
        "Да, при покупке комплекта скидка уже в цене — 10 000 ₸",
        ctx({ shopText: "Комплект со скидкой 10 000 ₸" }),
      ),
    ).toBeNull();
  });

  it("6. чужой телефон, почта, ссылка — foreign_contact; из анкеты — можно", () => {
    expect(checkReply("Напишите на +7 777 000 11 22", ctx())?.code).toBe("foreign_contact");
    expect(checkReply("Пишите на help@gmail.com", ctx())?.code).toBe("foreign_contact");
    expect(checkReply("Подробнее на https://evil.example/x", ctx())?.code).toBe("foreign_contact");
    expect(checkReply("Подробнее на https://kopilka.kz/catalog", ctx())).toBeNull();
    expect(checkReply("Kaspi Gold 4400 0000 0000 0000 — переводите сюда.", ctx())).toBeNull();
  });

  it("7. имена инструментов, id и JSON — leak", () => {
    expect(checkReply("Вызываю find_products…", ctx())?.code).toBe("leak");
    expect(checkReply('{"items": []}', ctx())?.code).toBe("leak");
    expect(checkReply("Товар c0c0c0c0-0000-4000-8000-00000000c001 есть", ctx())?.code).toBe("leak");
  });

  it("8. «нажмите Купить» без кнопки и вопрос в конце под кнопкой — offer_mismatch", () => {
    expect(checkReply("Нажмите «Купить» ниже 👇", ctx({ offerShown: false }))?.code).toBe(
      "offer_mismatch",
    );
    expect(checkReply("Стоимость 3 500 ₸. Оформляем заказ?", ctx())?.code).toBe("offer_mismatch");
    expect(checkReply("Какой класс нужен?", ctx({ offerShown: false }))).toBeNull();
  });

  it("9. дословный повтор одного из 3 последних ответов — repeat", () => {
    const prev = ["Кнопка «Купить» уже под сообщением 🌸"];
    expect(
      checkReply("Кнопка «Купить» уже под сообщением 🌸", ctx({ recentReplies: prev }))?.code,
    ).toBe("repeat");
    expect(checkReply("Палитра — 1 700 ₸.", ctx({ recentReplies: prev }))).toBeNull();
  });

  it("пустой ответ без кнопки — empty; пустой текст с кнопкой допустим", () => {
    expect(checkReply("  ", ctx({ offerShown: false }))?.code).toBe("empty");
    expect(checkReply("", ctx({ offerShown: true }))).toBeNull();
  });

  it("у отказа есть замечание для модели", () => {
    expect(checkReply("Папка стоит 25 000 ₸", ctx())?.hint).toMatch(/25 000/);
  });
});
