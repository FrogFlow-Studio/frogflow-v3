import { describe, expect, it } from "vitest";
import {
  COMMENT_NEUTRAL,
  COMMENT_SKIP,
  commentNote,
  commentReplyOn,
  pickCommentAnswer,
} from "./comment-reply";

const BOVI = "bb3ffba7-edf0-4cce-8742-ff10c9495c44";

describe("ответ на комментарий: что уходит покупателю", () => {
  const base = { handoff: false, attachments: 0 };

  it("ответ с ценой в тенге или рублях уходит как есть", () => {
    for (const reply of [
      "Cube Fazer 155×200 — 98 000 ₸",
      "Полотенце Pip Studio 70×140 — 18 900 тг",
      "Одеяло 200×200 — примерно 29 400 ₽",
    ])
      expect(pickCommentAnswer({ ...base, reply }, "ru")).toEqual({ kind: "price", text: reply });
  });

  it("без цены, с передачей, пустой, длиннее 1000 знаков — приглашение на языке комментария", () => {
    expect(pickCommentAnswer({ ...base, reply: "Какой размер?" }, "kk")).toMatchObject({
      kind: "neutral",
      text: COMMENT_NEUTRAL.kk,
    });
    expect(pickCommentAnswer({ ...base, handoff: true, reply: "98 000 ₸" }, "ru").kind).toBe(
      "neutral",
    );
    expect(pickCommentAnswer({ ...base, reply: "  " }, "ru").kind).toBe("neutral");
    expect(
      pickCommentAnswer({ ...base, reply: `98 000 ₸ ${"а".repeat(1000)}` }, "ru"),
    ).toMatchObject({ kind: "neutral", why: "ответ длиннее 1000 знаков" });
    expect(pickCommentAnswer(null, "en").text).toBe(COMMENT_NEUTRAL.en);
  });

  it("модель хотела приложить фото и пишет о нём — фото не будет, шлём приглашение", () => {
    expect(
      pickCommentAnswer({ reply: "Отправила фото, 98 000 ₸", handoff: false, attachments: 1 }, "ru")
        .kind,
    ).toBe("neutral");
    expect(
      pickCommentAnswer({ reply: "Cube Fazer — 98 000 ₸", handoff: false, attachments: 1 }, "ru")
        .kind,
    ).toBe("price");
  });

  it("модель ответила словом «не отвечать» — не шлём ничего; слово внутри ответа — не оно", () => {
    for (const reply of [COMMENT_SKIP, `${COMMENT_SKIP}.`, ` ${COMMENT_SKIP.toLowerCase()} `])
      expect(pickCommentAnswer({ ...base, reply }, "ru")).toMatchObject({ kind: "skip", text: "" });
    expect(
      pickCommentAnswer({ ...base, reply: `${COMMENT_SKIP}: Cube Fazer — 98 000 ₸` }, "ru").kind,
    ).toBe("price");
    // Правило — в пометке модели: эмодзи и похвала без вопроса, но «BOVI» — интерес.
    expect(commentNote()).toContain(COMMENT_SKIP);
    expect(commentNote()).toMatch(/эмодзи/);
    expect(commentNote()).toMatch(/BOVI/);
  });

  it("включено у BOVI по умолчанию, у остальных — по выбору продавца", () => {
    expect(commentReplyOn(undefined, BOVI)).toBe(true);
    expect(commentReplyOn("false", BOVI)).toBe(false);
    expect(commentReplyOn(undefined, "other")).toBe(false);
    expect(commentReplyOn("true", "other")).toBe(true);
  });
});
