import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buttonSchema, postTitleSchema } from "./instagram-input";

describe("форма правила Instagram", () => {
  it("команда боту с пустой ссылкой от формы сохраняется (Кристина Дидактика, 07.10)", () => {
    // Новая кнопка рождается ссылкой с url: "", потом её переключают на «команду боту».
    const b = buttonSchema.parse({
      type: "postback",
      title: "купить",
      url: "",
      payload: "CATALOG",
    });
    expect(b).toEqual({ type: "postback", title: "купить", payload: "CATALOG" });
  });
  it("команда боту не превращается в ссылку из старого поля", () => {
    const b = buttonSchema.parse({
      type: "postback",
      title: "купить",
      url: "https://example.com",
      payload: "CATALOG",
    });
    expect(b).not.toHaveProperty("url");
  });
  it("ссылка по-прежнему проверяется", () => {
    expect(() => buttonSchema.parse({ type: "url", title: "сайт", url: "" })).toThrow();
    expect(
      buttonSchema.parse({ type: "url", title: "сайт", url: "https://x.kz", payload: "X" }),
    ).toEqual({ type: "url", title: "сайт", url: "https://x.kz" });
  });
  it("длинная подпись Reels обрезается, а не валит форму", () => {
    const s = z.object({ postTitle: postTitleSchema }).parse({ postTitle: "а".repeat(2200) });
    expect(s.postTitle).toHaveLength(500);
    expect(z.object({ postTitle: postTitleSchema }).parse({}).postTitle).toBeUndefined();
  });
});
