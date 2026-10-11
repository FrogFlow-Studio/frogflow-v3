import { describe, expect, it } from "vitest";
import {
  classifyIncoming,
  emailStep,
  extractEmail,
  extractProductNumber,
  isAffirmative,
  isCancel,
  isLocalePickEcho,
  isPaymentComplaint,
  isPayTrouble,
  isFromRussia,
  isReceiptHowQuestion,
  LOCALE_PICK_ECHO_MS,
  matchCountry,
  matchDeliveryLangChoice,
  matchLoyaltyPointsChoice,
  matchDirectCommand,
  matchLocalePick,
  languagePickerText,
  extractNumberList,
  taggedKeyword,
  taggedProductNumber,
  isStepStale,
  STEP_TTL_MS,
  stepAnswer,
  whatsappList,
  clipRowTitle,
  rowSubtitle,
  WA_LIST_MAX_ROWS,
  matchOrdinal,
  matchZone,
  parseRemoveCommand,
  pickCartLineToRemove,
  pickReceiptAttachment,
  plain,
  productNumberFromKeywords,
  productNumberFromName,
} from "./shop-flow";
import { parseZernioMessage } from "./message";

/** Список стран — из настоящих payment_methods клиента. */
const countries = [
  { code: "KZ", name: "🇰🇿 Казахстан" },
  { code: "RU", name: "🇷🇺 Россия" },
  { code: "BY", name: "🇧🇾 Беларусь" },
  { code: "KG", name: "🇰🇬 Кыргызстан" },
  { code: "UZ", name: "🇺🇿 Узбекистан" },
  { code: "OTHER", name: "Другая страна" },
];

describe("extractProductNumber", () => {
  it("принимает номер в том виде, в каком его пишут покупатели", () => {
    for (const input of ["018", "18", "№18", "# 18", "18.", "18)"])
      expect(extractProductNumber(input), input).toBe("18");
  });
  it("снимает ведущие нули и не принимает за номер текст", () => {
    expect(extractProductNumber("000")).toBe("0");
    for (const input of ["привет", "18 штук", "1 класс", "123456", ""])
      expect(extractProductNumber(input), input).toBeNull();
  });
});

describe("productNumberFromName / Keywords", () => {
  it("берёт номер из названия во всех форматах клиента", () => {
    expect(productNumberFromName("018. Набор «Пазлы БУКВЫ»")).toBe("18");
    expect(productNumberFromName("236) Пазлы")).toBe("236");
    expect(productNumberFromName("081 | Дни недели")).toBe("81");
    expect(productNumberFromName("165 Календари")).toBe("165");
  });
  it("не принимает класс за номер и не выдумывает", () => {
    expect(productNumberFromName("Прописи для 1 класса")).toBeNull();
    expect(productNumberFromName(null)).toBeNull();
    expect(productNumberFromKeywords("018, пазлы, карточки")).toBe("18");
    expect(productNumberFromKeywords("пазлы, 018")).toBeNull();
  });
  it("голые цифры без разделителя — не номер из названия", () => {
    // У номера обязателен разделитель: «1» или «2026» — это не «001. …».
    expect(productNumberFromName("1")).toBeNull();
    expect(productNumberFromName("2026")).toBeNull();
  });
  it("класс в начале ключевых слов — не номер товара", () => {
    // «358. Тетрадь для диагностики техники чтения» с ключевыми словами
    // «1 класс русский язык» становилась товаром №1 и отвечала на «1».
    expect(productNumberFromKeywords("1 класс русский язык, 2 класс русский язык")).toBeNull();
    expect(productNumberFromKeywords("3 класс математика, счёт")).toBeNull();
  });
  it("пустые ключевые слова и слова без номера номера не дают", () => {
    expect(productNumberFromKeywords(null)).toBeNull();
    expect(productNumberFromKeywords(undefined)).toBeNull();
    expect(productNumberFromKeywords("")).toBeNull();
    expect(productNumberFromKeywords("пазлы, буквы")).toBeNull();
  });
});

describe("корзина: убрать позицию", () => {
  it("понимает просьбу убрать и находит позицию по номеру или месту", () => {
    expect(parseRemoveCommand("убрать 018")).toBe("18");
    expect(parseRemoveCommand("- №18")).toBe("18");
    expect(parseRemoveCommand("убери всё")).toBeNull();
    const names = ["018. Пазлы", "Прописи"];
    expect(pickCartLineToRemove("18", names)).toBe(0);
    expect(pickCartLineToRemove("2", names)).toBe(1);
    expect(pickCartLineToRemove("7", names)).toBeNull();
  });
});

describe("matchCountry", () => {
  it("номер из списка, название с флагом и не до конца, код", () => {
    expect(matchCountry("1", countries)?.code).toBe("KZ");
    expect(matchCountry("2.", countries)?.code).toBe("RU");
    expect(matchCountry("🇰🇿 Казахстан", countries)?.code).toBe("KZ");
    expect(matchCountry("казах", countries)?.code).toBe("KZ");
    expect(matchCountry("kz", countries)?.code).toBe("KZ");
  });
  it("не угадывает наугад", () => {
    expect(matchCountry("не знаю", countries)).toBeNull();
    expect(matchCountry("99", countries)).toBeNull();
    expect(matchCountry("ка", countries)).toBeNull();
  });
});

describe("несколько номеров одним сообщением", () => {
  it("«2 4 7», «2, 4, 7», столбиком и с решёткой — список; один номер и текст — нет", () => {
    expect(extractNumberList("2 4 7")).toEqual(["2", "4", "7"]);
    expect(extractNumberList("2, 4, 7")).toEqual(["2", "4", "7"]);
    expect(extractNumberList("2\n4\n7")).toEqual(["2", "4", "7"]);
    expect(extractNumberList("#130 #134, 130")).toEqual(["130", "134"]);
    expect(extractNumberList("2 и 4")).toEqual(["2", "4"]);
    expect(extractNumberList("5")).toBeNull();
    expect(extractNumberList("Россия")).toBeNull();
    expect(extractNumberList("хочу 2 и 4")).toBeNull();
  });
});

describe("код с решёткой в приветствии рекламы", () => {
  it("«Хочу материал #245» — товар 245; два кода или без решётки — нет", () => {
    expect(taggedProductNumber("Здравствуйте! Хочу материал #245")).toBe("245");
    expect(taggedProductNumber("Сборник № 018, можно подробнее?")).toBe("18");
    expect(taggedProductNumber("#12 и #13")).toBeNull();
    expect(taggedProductNumber("Привет! Можно узнать об этом подробнее?")).toBeNull();
    expect(taggedProductNumber("мне 245 штук")).toBeNull();
    expect(classifyIncoming("Хочу материал #245")).toEqual({
      kind: "product_number",
      number: "245",
    });
  });
});

describe("буквенный код с решёткой (AATeach, 07.10)", () => {
  it("«Хочу приобрести #кпп» — метка «кпп»; без решётки, две метки или число — нет", () => {
    expect(taggedKeyword("Здравствуйте. Хочу приобрести #кпп")).toBe("кпп");
    expect(taggedKeyword("#КПП")).toBe("кпп");
    expect(taggedKeyword("#план2026, пожалуйста")).toBe("план2026");
    expect(taggedKeyword("Кпп")).toBeNull();
    expect(taggedKeyword("#кпп и #план")).toBeNull();
    expect(taggedKeyword("#245")).toBeNull();
    expect(classifyIncoming("Хочу приобрести #кпп")).toEqual({ kind: "product_tag", tag: "кпп" });
    expect(classifyIncoming("Хочу #245")).toEqual({ kind: "product_number", number: "245" });
  });
});

describe("шаг сценария истекает", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("вопрос бота давностью больше срока — реплика уже не ответ на него", () => {
    expect(isStepStale("awaiting_country", ago(STEP_TTL_MS + 1), now)).toBe(true);
    expect(isStepStale("awaiting_country", ago(60_000), now)).toBe(false);
    expect(isStepStale("idle", ago(STEP_TTL_MS * 10), now)).toBe(false);
  });
  it("шаги оплаты не истекают; без отметки истекает только выбор языка", () => {
    expect(isStepStale("awaiting_proof", ago(STEP_TTL_MS * 10), now)).toBe(false);
    expect(isStepStale("awaiting_locale", undefined, now)).toBe(true);
    expect(isStepStale("awaiting_country", undefined, now)).toBe(false);
  });
});

describe("выбор языка по слову «язык»", () => {
  it("текст — на четырёх языках", () => {
    const text = languagePickerText();
    for (const part of [
      "Выберите язык",
      "Тілді таңдаңыз",
      "Tilni tanlang",
      "Choose language",
      "1. ",
      "4. ",
    ])
      expect(text).toContain(part);
  });
});

describe("язык словами (AATeach 11.10, «На русском»)", () => {
  it("«На русском», «по-казахски», «in English», «o‘zbek tilida» — выбор языка", () => {
    expect(matchLocalePick("На русском")).toBe("ru");
    expect(matchLocalePick("по-казахски")).toBe("kk");
    expect(matchLocalePick("in English")).toBe("en");
    expect(matchLocalePick("o‘zbek tilida")).toBe("uz");
    expect(matchDeliveryLangChoice("На русском", ["ru", "kk"])).toBe("ru");
    expect(matchDeliveryLangChoice("на казахском", ["ru", "kk"])).toBe("kk");
  });

  it("длинная фраза и два языка сразу — не выбор", () => {
    expect(matchLocalePick("я из России, пишу на русском языке")).toBeNull();
    expect(matchLocalePick("русский и казахский")).toBeNull();
    expect(matchDeliveryLangChoice("на английском", ["ru", "kk"])).toBeNull();
  });
});

describe("matchLocalePick / echo", () => {
  it("номер, код и родное название", () => {
    expect(matchLocalePick("1")).toBe("ru");
    expect(matchLocalePick("3)")).toBe("en");
    expect(matchLocalePick("KK")).toBe("kk");
    expect(matchLocalePick("Русский")).toBe("ru");
    expect(matchLocalePick("рус")).toBe("ru");
    expect(matchLocalePick("O‘zbekcha")).toBe("uz");
    expect(matchLocalePick("ру")).toBeNull();
    expect(matchLocalePick("99")).toBeNull();
  });
  it("повтор «1» сразу после выбора языка — не номер товара, после окна — номер", () => {
    const at = new Date(1_000_000).toISOString();
    expect(isLocalePickEcho("1", at, 1_000_000 + 5_000)).toBe(true);
    expect(isLocalePickEcho("1", at, 1_000_000 + LOCALE_PICK_ECHO_MS + 1)).toBe(false);
    expect(isLocalePickEcho("196", at, 1_000_000 + 5_000)).toBe(false);
    expect(isLocalePickEcho("1", undefined)).toBe(false);
  });
});

describe("matchZone / matchOrdinal", () => {
  const zones = [
    { id: "a", name: "Центр" },
    { id: "b", name: "Окраина" },
  ];
  it("номер или название", () => {
    expect(matchZone("2", zones)?.id).toBe("b");
    expect(matchZone("центр", zones)?.id).toBe("a");
    expect(matchZone("окр", zones)?.id).toBe("b");
    expect(matchZone("север", zones)).toBeNull();
    expect(matchOrdinal("3.", 5)).toBe(2);
    expect(matchOrdinal("9", 5)).toBeNull();
    expect(matchOrdinal("три", 5)).toBeNull();
  });
});

describe("pickReceiptAttachment", () => {
  it("берёт картинку или файл, старые события без типа — фото", () => {
    expect(pickReceiptAttachment([{ url: "https://cdn/1.jpg", type: "image" }])).toBe(
      "https://cdn/1.jpg",
    );
    expect(pickReceiptAttachment([{ url: "https://cdn/1.pdf", type: "file" }])).toBe(
      "https://cdn/1.pdf",
    );
    expect(pickReceiptAttachment([{ url: "https://cdn/1.jpg" }])).toBe("https://cdn/1.jpg");
  });
  it("не принимает голосовое, видео, пост и эхо шаблона; находит чек рядом с голосовым", () => {
    for (const type of ["audio", "video", "share", "ephemeral", "template"])
      expect(pickReceiptAttachment([{ url: "https://cdn/x", type }]), type).toBeNull();
    expect(
      pickReceiptAttachment([
        { url: "https://cdn/voice", type: "audio" },
        { url: "https://cdn/receipt.jpg", type: "image" },
      ]),
    ).toBe("https://cdn/receipt.jpg");
    expect(pickReceiptAttachment(null)).toBeNull();
  });
  it("не зависит от нового имени типа, если есть ссылка; картинка всё равно первая", () => {
    expect(pickReceiptAttachment([{ url: "https://cdn/new", type: "media" }])).toBe(
      "https://cdn/new",
    );
    expect(
      pickReceiptAttachment([
        { url: "https://cdn/new", type: "media" },
        { url: "https://cdn/r.jpg", type: "image" },
      ]),
    ).toBe("https://cdn/r.jpg");
    expect(
      pickReceiptAttachment([{ url: "https://cdn/x", type: "media", mimeType: "image/jpeg" }]),
    ).toBe("https://cdn/x");
    expect(
      pickReceiptAttachment([{ url: "https://cdn/v", type: "media", mimeType: "audio/ogg" }]),
    ).toBeNull();
    for (const type of ["voice", "sticker", "story_mention", "reel"])
      expect(pickReceiptAttachment([{ url: "https://cdn/x", type }]), type).toBeNull();
  });
  it("живые media-объекты Instagram и WhatsApp из события — это чек", () => {
    const event = (attachment: Record<string, unknown>) =>
      parseZernioMessage({
        event: "message.received",
        message: { text: null, attachments: [attachment as never] },
      }).attachments;
    expect(
      pickReceiptAttachment(
        event({
          type: "image",
          url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1",
          payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" },
        }),
      ),
    ).toContain("ig_messaging_cdn");
    expect(
      pickReceiptAttachment(
        event({
          type: "image",
          url: "https://zernio.com/api/v1/whatsapp/media/1?accountId=a1",
          payload: { mimeType: "image/jpeg" },
        }),
      ),
    ).toContain("/whatsapp/media/");
  });
});

describe("extractEmail", () => {
  it("находит адрес и не выдумывает", () => {
    expect(extractEmail("моя почта Anna.K@Example.com, спасибо")).toBe("anna.k@example.com");
    expect(extractEmail("нет почты")).toBeNull();
  });
  it("не принимает за почту ник Instagram и адрес словами", () => {
    for (const input of ["анна собака мейл ру", "@annavenglovskaia", "почта", ""])
      expect(extractEmail(input), input).toBeNull();
  });
});

describe("classifyIncoming", () => {
  it("номер, согласие, отказ, вопрос", () => {
    expect(classifyIncoming("196")).toEqual({ kind: "product_number", number: "196" });
    expect(classifyIncoming("Да").kind).toBe("affirmative");
    expect(isAffirmative("+")).toBe(true);
    expect(classifyIncoming("Здравствуйте, а скидка есть?").kind).toBe("question");
    for (const input of ["не нужно", "Нет", "нет.", "Спасибо!", "понятно", "всё"])
      expect(classifyIncoming(input).kind, input).toBe("dismissal");
    expect(classifyIncoming("Спасибо, а когда будет новый набор?").kind).toBe("question");
  });

  it("«интересует» и «интересно» — согласие, а не вопрос консультанту", () => {
    for (const input of ["интересует", "Интересует!", "интересует.", "Интересно"])
      expect(classifyIncoming(input).kind, input).toBe("affirmative");
  });
});

describe("isCancel", () => {
  it("все обычные способы выйти и ни одной обычной реплики", () => {
    for (const input of ["отмена", "Отмена!", "стоп", "заново", "/start", "хватит"])
      expect(isCancel(input), input).toBe(true);
    for (const input of ["Казахстан", "018", "отменяется ли заказ?"])
      expect(isCancel(input), input).toBe(false);
  });
});

describe("matchDirectCommand", () => {
  it("команды словом и подписи кнопок на всех языках магазина", () => {
    expect(matchDirectCommand("Корзина")).toBe("cart");
    expect(matchDirectCommand("Оформить заказ")).toBe("checkout");
    expect(matchDirectCommand("реквизиты")).toBe("checkout");
    expect(matchDirectCommand("мои заказы")).toBe("orders");
    expect(matchDirectCommand("Каталог!")).toBe("catalog");
    expect(matchDirectCommand("Тапсырысты рәсімдеу")).toBe("checkout");
    expect(matchDirectCommand("Savat")).toBe("cart");
    expect(matchDirectCommand("тіл")).toBe("language");
    expect(matchDirectCommand("сменить страну")).toBe("country");
  });
  it("живая фраза с командой внутри — не команда", () => {
    for (const input of [
      "Я оплатила 400тг вам, вы материал мне не отправили",
      "а где мой заказ, я оплатила вчера",
      "в корзине что-то не так",
    ])
      expect(matchDirectCommand(input), input).toBeNull();
  });
});

describe("isPaymentComplaint", () => {
  it("узнаёт жалобу и не считает жалобой вопрос", () => {
    for (const input of [
      "Я оплатила 400тг вам, вы материал мне не отправили",
      "Верните мои деньги",
      "файл не открывается",
      "где мой материал?",
      "это обман какой-то",
    ])
      expect(isPaymentComplaint(input), input).toBe(true);
    for (const input of [
      "как оплатить?",
      "не могу найти реквизиты",
      "196",
      "я ещё не оплатила",
      "",
    ])
      expect(isPaymentComplaint(input), input).toBe(false);
  });
});

describe("plain", () => {
  it("снимает HTML и сущности для Instagram", () => {
    expect(plain("<b>Заказ #5</b>\n&lt;3 &amp; «ок»")).toBe("Заказ #5\n<3 & «ок»");
  });
});

describe("matchDeliveryLangChoice", () => {
  const langs = ["ru", "kk"] as const;
  it("номер из показанного списка: языки, затем «все»; «1 класс» и номер товара — нет", () => {
    expect(matchDeliveryLangChoice("1", [...langs])).toBe("ru");
    expect(matchDeliveryLangChoice("2.", [...langs])).toBe("kk");
    expect(matchDeliveryLangChoice("3", [...langs])).toBe("all");
    expect(matchDeliveryLangChoice("1 класс", [...langs])).toBeNull();
    expect(matchDeliveryLangChoice("018", [...langs])).toBeNull();
    expect(matchDeliveryLangChoice("4", [...langs])).toBeNull();
  });
  it("название языка, постбэк кнопки, «оба» / «все языки»", () => {
    expect(matchDeliveryLangChoice("Русский", [...langs])).toBe("ru");
    expect(matchDeliveryLangChoice("қазақша", [...langs])).toBe("kk");
    expect(matchDeliveryLangChoice("kz", [...langs])).toBe("kk");
    expect(matchDeliveryLangChoice("deliverylang:ru", [...langs])).toBe("ru");
    expect(matchDeliveryLangChoice("deliverylang:all", [...langs])).toBe("all");
    expect(matchDeliveryLangChoice("оба", [...langs])).toBe("all");
    expect(matchDeliveryLangChoice("все языки", [...langs])).toBe("all");
    expect(matchDeliveryLangChoice("english", [...langs])).toBeNull();
  });
});

describe("списки WhatsApp", () => {
  it("режет строки по лимитам Meta и не выходит за десять строк на сообщение", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `PROD:${i}`,
      title: `Очень длинное название товара номер ${i}`,
      description: "x".repeat(100),
    }));
    const list = whatsappList({
      body: "Каталог",
      buttonLabel: "Открыть каталог, пожалуйста",
      sections: [
        { title: "Товары", rows },
        { title: "…", rows: [{ id: "CART", title: "Корзина" }] },
      ],
    }) as {
      type: string;
      action: {
        button: string;
        sections: Array<{ rows: Array<{ title: string; description?: string }> }>;
      };
    };
    expect(list.type).toBe("list");
    expect(list.action.button.length).toBeLessThanOrEqual(20);
    const total = list.action.sections.reduce((n, sct) => n + sct.rows.length, 0);
    expect(total).toBe(WA_LIST_MAX_ROWS);
    expect(list.action.sections).toHaveLength(1); // бюджет ушёл на первую секцию
    for (const r of list.action.sections[0]!.rows) {
      expect(r.title.length).toBeLessThanOrEqual(24);
      expect(r.description!.length).toBeLessThanOrEqual(72);
    }
  });
  it("пустые секции пропускаются, короткие заголовки не трогаются", () => {
    const list = whatsappList({
      body: "Страна",
      buttonLabel: "Выбрать",
      sections: [
        { title: "Пусто", rows: [] },
        { title: "Страна", rows: [{ id: "STEP:1", title: "Казахстан" }] },
      ],
    }) as { action: { sections: Array<{ title: string }> } };
    expect(list.action.sections.map((x) => x.title)).toEqual(["Страна"]);
    expect(clipRowTitle("Казахстан")).toBe("Казахстан");
    expect(clipRowTitle("Набор прописей для первого класса", 24)).toMatch(/…$/);
  });
  it("строка STEP:<n> — ответ на шаг, остальные postback — команды", () => {
    expect(stepAnswer("STEP:3")).toBe("3");
    expect(stepAnswer("CART")).toBeNull();
    expect(stepAnswer(null)).toBeNull();
    expect(stepAnswer("STEP:")).toBeNull();
  });
});

describe("вторая строка товара в списке WhatsApp", () => {
  it("короткому названию описание — просто цена", () => {
    expect(rowSubtitle("Пазлы", "600 ₸")).toBe("600 ₸");
  });

  it("длинное название продолжается в описании — там товары и расходятся", () => {
    const a = "034. Декор на дверь к 1 сентября";
    const b = "034. Декор на дверь к 1 мая";
    expect(clipRowTitle(a)).toBe(clipRowTitle(b));
    expect(rowSubtitle(a, "600 ₸")).toBe("сентября · 600 ₸");
    expect(rowSubtitle(b, "600 ₸")).toBe("мая · 600 ₸");
    // Хвост начинается ровно там, где заголовок оборвался на «…».
    expect(clipRowTitle(a).replace("…", "") + " " + "сентября").toBe(a);
  });

  it("цена дописывается, когда остаётся место", () => {
    const name = `${"а".repeat(23)}${"б".repeat(30)}`;
    expect(rowSubtitle(name, "1 200 ₸")).toBe(`${"б".repeat(30)} · 1 200 ₸`);
  });

  it("не влезает вместе — хвост названия важнее цены", () => {
    const name = `${"а".repeat(23)}${"б".repeat(70)}`;
    const d = rowSubtitle(name, "1 200 ₸");
    expect(d).toBe("б".repeat(70));
    expect(d).not.toContain("₸");
    // Хвост длиннее 72 обрежет whatsappList — с многоточием, как заголовок.
  });
});

describe("emailStep — шаг «ваша почта»", () => {
  const base = {
    platform: "instagram",
    physical: false,
    knownEmail: null,
    skipped: false,
    mailReady: true,
  };
  it("в переписке шага нет нигде: файлы приходят в чат, вопрос терял покупателей (Копилка, 09.10)", () => {
    for (const platform of ["instagram", "whatsapp", "telegram"])
      expect(emailStep({ ...base, platform }), platform).toBeNull();
  });
  it("«отмена» понимается на всех языках покупателя", () => {
    for (const w of ["отмена", "Cancel", "болдырмау", "bekor"]) expect(isCancel(w), w).toBe(true);
  });
  it("почта вытаскивается из фразы и приводится к нижнему регистру", () => {
    expect(extractEmail("Почта: Anna.Probe@Example.com")).toBe("anna.probe@example.com");
    expect(extractEmail("мой ящик анна")).toBeNull();
  });
});

describe("matchLoyaltyPointsChoice", () => {
  it("принимает кнопки и короткие да/нет", () => {
    expect(matchLoyaltyPointsChoice("Да, списать")).toBe("yes");
    expect(matchLoyaltyPointsChoice("да")).toBe("yes");
    expect(matchLoyaltyPointsChoice("LOYALTY:yes")).toBe("yes");
    expect(matchLoyaltyPointsChoice("Yes, use")).toBe("yes");
    expect(matchLoyaltyPointsChoice("Иә")).toBe("yes");
    expect(matchLoyaltyPointsChoice("Нет, копить")).toBe("no");
    expect(matchLoyaltyPointsChoice("нет")).toBe("no");
    expect(matchLoyaltyPointsChoice("LOYALTY:no")).toBe("no");
    expect(matchLoyaltyPointsChoice("No, keep")).toBe("no");
    expect(matchLoyaltyPointsChoice("жоқ")).toBe("no");
  });

  it("не путает вежливый отказ от разговора с отказом списывать бонусы", () => {
    expect(matchLoyaltyPointsChoice("спасибо")).toBeNull();
    expect(matchLoyaltyPointsChoice("хорошо")).toBeNull();
    expect(matchLoyaltyPointsChoice("018")).toBeNull();
    expect(matchLoyaltyPointsChoice("нет, спасибо, не надо мне писать")).toBeNull();
    expect(matchLoyaltyPointsChoice("данные карты где?")).toBeNull();
  });
});

describe("телефон не коды товаров (Б2)", () => {
  it.each([
    "87770637152",
    "8 (777) 063-71-52",
    "+7 777 063 71 52",
    "+998 90 123 45 67",
    "8 777 063 71 52",
  ])("«%s» — телефон", (t) => {
    expect(classifyIncoming(t).kind).toBe("phone");
    expect(extractNumberList(t)).toBeNull();
  });

  it.each(["002 015", "2 4 7", "130 134 136 138", "1, 2, 3, 4, 5, 6, 7, 8, 9, 10", "#130 #134"])(
    "«%s» — коды товаров, не телефон",
    (t) => {
      expect(classifyIncoming(t).kind).toBe("product_numbers");
    },
  );

  it("длинная цифровая строка не режется на пятизначные «коды»", () => {
    expect(extractNumberList("1234567890 2")).toBeNull();
    expect(classifyIncoming("1234567890123")).toEqual({ kind: "phone", digits: "1234567890123" });
  });

  it("одиночный номер и вопрос остаются как были", () => {
    expect(classifyIncoming("018")).toEqual({ kind: "product_number", number: "18" });
    expect(classifyIncoming("сколько стоит?").kind).toBe("question");
  });
});

describe("isPayTrouble: покупатель не из Казахстана или без Kaspi", () => {
  it("страна, «нет каспи» — вопрос продавцу (Копилка, 09.10, заказ #62)", () => {
    for (const t of [
      "Я из Беларуси",
      "я живу в Узбекистане",
      "Мы из РБ",
      "У меня белорусская карта",
      "Я не из Казахстана",
      "Каспи нет",
      "А без Kaspi можно?",
      "Я из России",
    ])
      expect(isPayTrouble(t), t).toBe(true);
  });

  it("обычные реплики на шаге оплаты — не повод звать продавца", () => {
    for (const t of [
      "Оплатила",
      "Чек отправила",
      "Спасибо",
      "Из Алматы",
      "в английском варианте есть?",
    ])
      expect(isPayTrouble(t), t).toBe(false);
  });
});

describe("isReceiptHowQuestion: как прислать чек (заказ #72 Копилки, 10.10)", () => {
  it("узнаёт вопрос о том, как приложить чек", () => {
    for (const t of [
      "Не знаю как",
      "не знаю как)",
      "Я не понимаю как",
      "Как отправить чек?",
      "А куда скинуть чек?",
      "как вам отправить скрин",
      "Как его отправить?",
      "не получается отправить фото",
      "How do I send the receipt?",
      "Чекті қалай жіберемін?",
      "Chekni qanday yuboraman?",
    ])
      expect(isReceiptHowQuestion(t), t).toBe(true);
  });
  it("не путает с другими вопросами", () => {
    for (const t of [
      "Я оплатила",
      "Как оплатить?",
      "Куда отправить деньги?",
      "не знаю как оплатить",
      "Как отправить материал на почту?",
      "Спасибо",
    ])
      expect(isReceiptHowQuestion(t), t).toBe(false);
  });
});

describe("isPayTrouble/isFromRussia: города и регионы (заказы #65, #76 Копилки, 10.10)", () => {
  it("город Узбекистана — не из Казахстана, Россия — по региону", () => {
    expect(isPayTrouble("Я из Нукуса")).toBe(true);
    expect(isPayTrouble("я с Ташкента")).toBe(true);
    expect(isPayTrouble("Я с Дагестана")).toBe(true);
    expect(isFromRussia("Я с Дагестана")).toBe(true);
    expect(isFromRussia("из Москвы")).toBe(true);
    expect(isFromRussia("Я из Нукуса")).toBe(false);
    expect(isFromRussia("из Самарканда")).toBe(false);
    expect(isFromRussia("я из Перми")).toBe(true);
  });
  it("Казахстан и обычные слова не путает", () => {
    for (const t of [
      "Я из Алматы",
      "из Казахстана",
      "в Астане",
      "с удовольствием",
      "в пермаментном",
    ])
      expect(isPayTrouble(t), t).toBe(false);
  });
});
