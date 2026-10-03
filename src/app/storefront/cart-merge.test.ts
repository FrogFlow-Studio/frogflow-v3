import { describe, expect, it } from "vitest";
import type { CartLine } from "./cart";
import { mergeCartLines } from "./cart-merge";

const line = (id: string, over: Partial<CartLine> = {}): CartLine => ({
  productId: id,
  variantId: null,
  name: id,
  price: 100,
  currency: "KZT",
  image: null,
  qty: 1,
  kind: "physical",
  ...over,
});

describe("несколько позиций в корзину витрины", () => {
  it("кладёт все за раз, а не только последнюю", () => {
    const r = mergeCartLines([], [line("a", { qty: 2 }), line("b")]);
    expect(r.lines.map((l) => [l.productId, l.qty])).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
    expect(r.added).toHaveLength(2);
  });

  it("лежащая позиция получает сегодняшнюю цену, количество складывается до 99", () => {
    const r = mergeCartLines(
      [line("a", { qty: 98, price: 100 })],
      [line("a", { qty: 5, price: 150 })],
    );
    expect(r.lines).toEqual([expect.objectContaining({ productId: "a", qty: 99, price: 150 })]);
  });

  it("файл остаётся в одном экземпляре", () => {
    const d = line("f", { kind: "digital" });
    expect(mergeCartLines([d], [{ ...d, qty: 3 }]).lines[0]!.qty).toBe(1);
  });

  it("другой вид товара не смешивается: уходит в mixed, корзина не меняется", () => {
    const cur = [line("a")];
    const r = mergeCartLines(cur, [line("f", { kind: "digital" })]);
    expect(r.mixed.map((l) => l.productId)).toEqual(["f"]);
    expect(r.added).toEqual([]);
    expect(r.lines).toEqual(cur);
  });
});
