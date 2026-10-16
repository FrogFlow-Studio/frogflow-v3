import { describe, expect, it } from "vitest";
import { normalizeInboxMessage } from "./inbox-types";
import { ACTIVE_MANAGER_WINDOW_MS, findManagerMessage } from "./manager-guard";

const NOW = Date.parse("2026-09-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const min = (n: number) => n * 60_000;

describe("менеджер в чате", () => {
  it("ловит ответ менеджера, даже если после него написал покупатель", () => {
    const found = findManagerMessage(
      [
        { direction: "outgoing", message: "Здравствуйте! Чем помочь?", createdAt: ago(min(10)) },
        { direction: "outgoing", message: "Сейчас не работаем", createdAt: ago(min(5)) },
        { direction: "incoming", message: "а когда?", createdAt: ago(min(4)) },
      ],
      { lastBotReplyAt: ago(min(10)), ourReplies: ["Здравствуйте! Чем помочь?"] },
      NOW,
    );
    expect(found?.text).toBe("Сейчас не работаем");
  });

  it("свой же ответ бота менеджером не считает, включая пришедший в ленту с задержкой", () => {
    expect(
      findManagerMessage(
        [{ direction: "outgoing", message: "Здравствуйте! Чем помочь?", createdAt: ago(min(9)) }],
        { lastBotReplyAt: ago(min(10)), ourReplies: ["Здравствуйте! Чем помочь?"] },
        NOW,
      ),
    ).toBeNull();
    expect(
      findManagerMessage(
        [{ direction: "outgoing", message: "Ответ бота!", createdAt: ago(min(10) - 30_000) }],
        { lastBotReplyAt: ago(min(10)), ourReplies: ["ответ бота"] },
        NOW,
      ),
    ).toBeNull();
  });

  it("старое сообщение менеджера бота не глушит", () => {
    expect(
      findManagerMessage(
        [{ direction: "outgoing", message: "Добрый день", createdAt: ago(min(60 * 24 * 3)) }],
        { lastBotReplyAt: ago(min(60)), ourReplies: [] },
        NOW,
      ),
    ).toBeNull();
    expect(
      findManagerMessage(
        [{ direction: "outgoing", message: "Добрый день", createdAt: ago(min(60 * 24 * 3)) }],
        { ourReplies: [] },
        NOW,
      ),
    ).toBeNull();
  });

  it("входящие сообщения менеджером не считаются", () => {
    expect(
      findManagerMessage(
        [{ direction: "incoming", message: "Сейчас не работаем", createdAt: ago(min(1)) }],
        { ourReplies: [] },
        NOW,
      ),
    ).toBeNull();
  });

  it("менеджер недавно писал — молчим, даже если бот успел ответить после него", () => {
    const found = findManagerMessage(
      [
        {
          direction: "outgoing",
          message: "Я подключусь",
          createdAt: ago(ACTIVE_MANAGER_WINDOW_MS - min(5)),
        },
        { direction: "outgoing", message: "Ответ бота", createdAt: ago(min(2)) },
      ],
      { lastBotReplyAt: ago(min(2)), ourReplies: ["Ответ бота"] },
      NOW,
    );
    expect(found?.text).toBe("Я подключусь");
  });

  it("читает текст и время в написании вебхука", () => {
    const m = normalizeInboxMessage({ direction: "outgoing", text: "Привет", sentAt: ago(min(1)) });
    expect(findManagerMessage([m], { ourReplies: [] }, NOW)?.text).toBe("Привет");
  });

  it("пустая переписка ничего не ломает", () => {
    expect(findManagerMessage([], { ourReplies: [] }, NOW)).toBeNull();
  });

  it("пустая или из одних знаков реплика бота не делает «своими» все исходящие", () => {
    // v1: пустой фрагмент совпадал с любым текстом, и менеджер «пропадал».
    const found = findManagerMessage(
      [{ direction: "outgoing", message: "Сейчас подключусь, минуту", createdAt: ago(min(2)) }],
      { lastBotReplyAt: ago(min(60)), ourReplies: ["", "   ", "!!!", "👍"] },
      NOW,
    );
    expect(found?.text).toBe("Сейчас подключусь, минуту");
  });

  it("вчерашний менеджер не держит бота в паузе: окно поиска не длиннее паузы", () => {
    // Бот последний раз отвечал вчера — окно поиска раньше уходило на сутки назад.
    const tail = [
      {
        direction: "outgoing" as const,
        message: "Добрый вечер, я менеджер",
        createdAt: ago(min(20 * 60)),
      },
    ];
    const state = { lastBotReplyAt: ago(min(24 * 60)), ourReplies: [] };
    expect(findManagerMessage(tail, state, NOW)?.text).toBe("Добрый вечер, я менеджер");
    expect(findManagerMessage(tail, { ...state, pauseWindowMs: min(12 * 60) }, NOW)).toBeNull();
  });

  it("«вернуть бота»: реплика менеджера до возврата паузу не ставит, после — ставит", () => {
    const tail = [
      { direction: "outgoing" as const, message: "Ответил сам", createdAt: ago(min(10)) },
    ];
    const state = { lastBotReplyAt: ago(min(20)), ourReplies: [], resumedAt: ago(min(5)) };
    expect(findManagerMessage(tail, state, NOW)).toBeNull();
    const later = [
      ...tail,
      { direction: "outgoing" as const, message: "Ещё раз я", createdAt: ago(min(2)) },
    ];
    expect(findManagerMessage(later, state, NOW)?.text).toBe("Ещё раз я");
  });
});

describe("свой ответ в рублях (BOVI 15.10)", () => {
  const tenge =
    "Цены привожу в тенге, вы увидите их в рублях: комплекты 155x200 - от 80 000 ₸, 200x220 - от 120 000 ₸, 240x220 - от 130 000 ₸. Какой размер и цвет вас интересует?";
  const rub =
    "Цены привожу в тенге, вы увидите их в рублях: комплекты 155x200 - от 19 052 ₽, 200x220 - от 28 578 ₽, 240x220 - от 30 960 ₽. Какой размер и цвет вас интересует?";

  it("ответ, ушедший в рублях, — наш, хотя в памяти он в тенге", () => {
    expect(
      findManagerMessage(
        [{ direction: "outgoing", message: rub, createdAt: ago(min(1)) }],
        { lastBotReplyAt: ago(min(1)), ourReplies: [tenge] },
        NOW,
      ),
    ).toBeNull();
  });

  it("пометка «ориентировочные» и «≈» тоже не делают ответ чужим", () => {
    expect(
      findManagerMessage(
        [
          {
            direction: "outgoing",
            message: "Полотенце 50х100 - ≈2 140 ₽.\n\nЦены в рублях ориентировочные.",
            createdAt: ago(min(1)),
          },
        ],
        { lastBotReplyAt: ago(min(1)), ourReplies: ["Полотенце 50х100 - 9 000 тенге."] },
        NOW,
      ),
    ).toBeNull();
  });

  it("менеджер, написавший другими словами, по-прежнему менеджер", () => {
    const found = findManagerMessage(
      [
        { direction: "outgoing", message: rub, createdAt: ago(min(3)) },
        {
          direction: "outgoing",
          message: "Да, СДЭКом отправляем, 3-5 дней",
          createdAt: ago(min(1)),
        },
      ],
      { lastBotReplyAt: ago(min(3)), ourReplies: [tenge] },
      NOW,
    );
    expect(found?.text).toBe("Да, СДЭКом отправляем, 3-5 дней");
  });
});

describe("сообщение правила Zernio на комментарий (BOVI 16.10)", () => {
  const rule =
    "Здравствуйте! С удовольствием поможем вам с подбором!\nЦены начинаются от 70.000 тенге✨\n\nПодскажите, какой размер и цвет вам подобрать?";

  it("текст правила «комментарий → Директ» — не менеджер", () => {
    const tail = [{ direction: "outgoing", message: rule, createdAt: ago(min(1)) }];
    expect(findManagerMessage(tail, { ourReplies: [] }, NOW)?.text).toBe(rule);
    expect(findManagerMessage(tail, { ourReplies: [], scenarioTexts: [rule] }, NOW)).toBeNull();
  });

  it("исходящее с пометкой сценария Zernio — не менеджер", () => {
    expect(
      findManagerMessage(
        [
          {
            direction: "outgoing",
            message: "Пришлём наличие и цены",
            automationId: "a1",
            createdAt: ago(min(1)),
          },
        ],
        { ourReplies: [] },
        NOW,
      ),
    ).toBeNull();
  });

  it("продавец, написавший после правила своими словами, — менеджер", () => {
    const found = findManagerMessage(
      [
        { direction: "outgoing", message: rule, createdAt: ago(min(3)) },
        { direction: "outgoing", message: "120х200 нет, есть 140х200", createdAt: ago(min(1)) },
      ],
      { ourReplies: [], scenarioTexts: [rule] },
      NOW,
    );
    expect(found?.text).toBe("120х200 нет, есть 140х200");
  });
});
