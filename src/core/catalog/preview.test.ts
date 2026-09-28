import { describe, expect, it } from "vitest";
import { parsePreview } from "./preview";

const T = "11111111-1111-1111-1111-111111111111";

describe("пример цифрового товара", () => {
  it("только ключи своего магазина, не больше пяти; мусор — пусто", () => {
    const own = (n: number) => `${T}/${"a".repeat(23)}${n}.jpg`;
    expect(
      parsePreview(
        JSON.stringify([own(1), "22222222-2222-2222-2222-222222222222/x.jpg", own(2)]),
        T,
      ),
    ).toEqual([own(1), own(2)]);
    expect(parsePreview(JSON.stringify([1, 2, 3, 4, 5, 6, 7].map(own)), T)).toHaveLength(5);
    expect(parsePreview("не json", T)).toEqual([]);
    expect(parsePreview(null, T)).toEqual([]);
  });
});
