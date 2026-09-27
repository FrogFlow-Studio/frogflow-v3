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
});
