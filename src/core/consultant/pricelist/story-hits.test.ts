import { describe, expect, it } from "vitest";
import type { StoryTag } from "../story-tags";
import type { ConsultantProduct } from "./catalog";
import { storyHits } from "./story-hits";

const product = (id: string, name: string, stock = true): ConsultantProduct => ({
  id,
  name,
  category: "",
  size: "",
  colors: [],
  price_kzt: 1000,
  stock,
});

const tag = (id: string, at: string, products: { id: string; name: string }[]): StoryTag => ({
  id,
  story_id: id,
  story_url: null,
  product_id: products[0]?.id ?? null,
  product_name: products[0]?.name ?? "",
  price: null,
  notes: null,
  created_at: at,
  products: products.map((p) => ({ ...p, price: null })),
});

const catalog = [
  product("A", "Uchino полотенце Merveille"),
  product("B", "BOVI КПБ PECAN"),
  product("C", "Blomus SONO диспенсер"),
  product("D", "BOVI скатерть PALACE"),
  product("E", "Traumina одеяло Cube", false),
];

describe("хиты из отмеченных сторис", () => {
  it("новые сторис первыми, по одному товару с каждой, без повторов и без нет-в-наличии", () => {
    const hits = storyHits(
      [
        tag("1", "2026-09-21T00:00:00Z", [{ id: "A", name: "Uchino полотенце Merveille" }]),
        tag("2", "2026-10-04T00:00:00Z", [
          { id: "B", name: "BOVI КПБ PECAN" },
          { id: "D", name: "BOVI скатерть PALACE" },
        ]),
        tag("3", "2026-10-03T00:00:00Z", [{ id: "E", name: "Traumina одеяло Cube" }]),
        tag("4", "2026-10-02T00:00:00Z", [{ id: "A", name: "Uchino полотенце Merveille" }]),
        tag("5", "2026-10-01T00:00:00Z", [{ id: "C", name: "Blomus SONO диспенсер" }]),
      ],
      catalog,
    );
    expect(hits.map((p) => p.id)).toEqual(["B", "A", "C"]);
  });

  it("товар отметки без id находится по названию; отметок нет — хитов нет", () => {
    expect(
      storyHits([tag("1", "2026-10-01T00:00:00Z", [{ id: "", name: "Blomus SONO" }])], catalog).map(
        (p) => p.id,
      ),
    ).toEqual(["C"]);
    expect(storyHits([], catalog)).toEqual([]);
  });
});
