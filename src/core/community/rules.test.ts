import { describe, expect, it } from "vitest";
import { adviceProblems } from "./rules";

describe("вопрос в сообщество: проверка на личное и суммы", () => {
  it("обычный вопрос проходит, в том числе с мелкими числами", () => {
    expect(adviceProblems("Как вести остатки? У меня 3 склада и 12 товаров.")).toEqual([]);
    expect(adviceProblems("Какую скидку 10% делаете на вторую покупку?")).toEqual([]);
  });
  it("контакты и суммы находятся", () => {
    expect(adviceProblems("a@b.kz")).toEqual(["contact"]);
    expect(adviceProblems("+7 (701) 123-45-67")).toEqual(["contact"]);
    expect(adviceProblems("@anna_shop")).toEqual(["contact"]);
    expect(adviceProblems("15 000 ₸")).toEqual(["money"]);
    expect(adviceProblems("пишите instagram.com/x и 300 руб")).toEqual(["contact", "money"]);
  });
});
