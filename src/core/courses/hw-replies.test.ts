import { describe, expect, it } from "vitest";
import {
  fillHwReply,
  HW_COMMENT_MAX,
  HW_REPLIES_MAX,
  hwCommentFromReply,
  parseHwReplies,
  parseHwReplyCommand,
} from "./hw-replies";

/** Быстрые ответы куратора к ДЗ (А35): чистка списка, подстановка имени, команда «#N». */
describe("быстрые ответы куратора", () => {
  it("список: пустые уходят, название по умолчанию — начало текста, длины режутся, не больше лимита", () => {
    const r = parseHwReplies([
      { title: "  Молодец  ", text: " Отлично, {name}! " },
      { title: "", text: "Переделайте\nвторую часть" },
      { title: "пусто", text: "   " },
      null,
      "мусор",
      { title: "я".repeat(100), text: "т".repeat(2000) },
    ]);
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ title: "Молодец", text: "Отлично, {name}!" });
    expect(r[1]).toEqual({ title: "Переделайте", text: "Переделайте\nвторую часть" });
    expect(r[2]!.title).toHaveLength(60);
    expect(r[2]!.text).toHaveLength(1000);
    expect(parseHwReplies("не массив")).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({ title: `t${i}`, text: `x${i}` }));
    expect(parseHwReplies(many)).toHaveLength(HW_REPLIES_MAX);
  });

  it("{name}: первое слово имени; без имени запятая и пробел не остаются", () => {
    expect(fillHwReply("Отлично, {name}! Работа принята.", "Мария Иванова")).toBe(
      "Отлично, Мария! Работа принята.",
    );
    expect(fillHwReply("Отлично, {name}!", "")).toBe("Отлично!");
    expect(fillHwReply("{name}, посмотрите ещё раз", null)).toBe("посмотрите ещё раз");
    expect(fillHwReply("Без подстановок", "Мария")).toBe("Без подстановок");
  });

  it("команда: «#» — список, «#2» и «#2 слова» — шаблон; всё прочее — обычный комментарий", () => {
    expect(parseHwReplyCommand("#")).toEqual({ kind: "list" });
    expect(parseHwReplyCommand(" # ")).toEqual({ kind: "list" });
    expect(parseHwReplyCommand("#2")).toEqual({ kind: "use", n: 2, extra: "" });
    expect(parseHwReplyCommand("#12 и ещё\nстрока")).toEqual({
      kind: "use",
      n: 12,
      extra: "и ещё\nстрока",
    });
    for (const t of ["Круг кривоват #2", "#abc", "#123", "##", "2", "хэштег #круг"])
      expect(parseHwReplyCommand(t)).toBeNull();
  });

  it("комментарий из шаблона: имя подставлено, добавка в конце, нет номера — null", () => {
    const replies = parseHwReplies([
      { title: "Молодец", text: "Отлично, {name}!" },
      { title: "Доработать", text: "Переделайте второй шаг." },
    ]);
    expect(hwCommentFromReply(replies, { kind: "use", n: 1, extra: "" }, "Мария К.")).toBe(
      "Отлично, Мария!",
    );
    expect(
      hwCommentFromReply(replies, { kind: "use", n: 2, extra: "Срок — пятница." }, "Мария"),
    ).toBe("Переделайте второй шаг.\n\nСрок — пятница.");
    expect(hwCommentFromReply(replies, { kind: "use", n: 3, extra: "" }, "Мария")).toBeNull();
    expect(hwCommentFromReply(replies, { kind: "use", n: 0, extra: "" }, "Мария")).toBeNull();
    const long = hwCommentFromReply(replies, { kind: "use", n: 2, extra: "я".repeat(5000) }, "М")!;
    expect(long.length).toBe(HW_COMMENT_MAX);
  });
});
