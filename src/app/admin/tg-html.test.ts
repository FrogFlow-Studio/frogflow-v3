import { describe, expect, it } from "vitest";
import { parseTgHtml } from "./tg-html";

describe("разметка Telegram в предпросмотре", () => {
  it("жирный, курсив и сущности", () => {
    expect(parseTgHtml("📦 <b>Пазл &lt;мини&gt; &amp; ко</b>\n<i>скоро</i>")).toEqual([
      "📦 ",
      { tag: "b", children: ["Пазл <мини> & ко"] },
      "\n",
      { tag: "i", children: ["скоро"] },
    ]);
  });

  it("чужой тег и скрипт остаются текстом", () => {
    expect(parseTgHtml('<script>alert("x")</script><b>ok</b>')).toEqual([
      '<script>alert("x")</script>',
      { tag: "b", children: ["ok"] },
    ]);
  });

  it("вложенные теги", () => {
    expect(parseTgHtml("<b>a <i>b</i></b>")).toEqual([
      { tag: "b", children: ["a ", { tag: "i", children: ["b"] }] },
    ]);
  });
});
