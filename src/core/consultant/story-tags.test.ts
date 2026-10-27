import { describe, expect, it } from "vitest";
import {
  extractInstagramMediaInfo,
  findStoryTag,
  findStoryTagFor,
  mergeLegacyStoryTags,
  storyContextLine,
  storyProductsOf,
  type StoryTag,
} from "./story-tags";

const tag = (over: Partial<StoryTag>): StoryTag => ({
  id: "st1",
  story_id: "ABC123xyz",
  story_url: "https://www.instagram.com/reel/ABC123xyz/",
  product_id: null,
  product_name: "Полотенце банное",
  price: 12000,
  notes: null,
  created_at: "2026-09-01T00:00:00Z",
  ...over,
});

describe("сторис-теги консультанта", () => {
  it("разбирает ссылки на рилс, пост, сторис и голый код", () => {
    expect(extractInstagramMediaInfo("https://instagram.com/reels/Cx1_-Y/?igsh=1")).toMatchObject({
      shortcode: "Cx1_-Y",
      type: "reel",
    });
    expect(extractInstagramMediaInfo("https://www.instagram.com/p/Cpost99/")).toMatchObject({
      shortcode: "Cpost99",
      type: "post",
    });
    expect(
      extractInstagramMediaInfo("https://www.instagram.com/stories/shop_kz/3412345678901234567/"),
    ).toMatchObject({ shortcode: "3412345678901234567", type: "story" });
    expect(extractInstagramMediaInfo("Cx1_-Yabc")).toMatchObject({ shortcode: "Cx1_-Yabc" });
    expect(extractInstagramMediaInfo("просто текст").shortcode).toBeNull();
  });

  it("находит тег по id, по ссылке, по коду в ссылке и по числу в id", () => {
    const tags = [tag({}), tag({ id: "st2", story_id: "3412345678901234567", story_url: null })];
    expect(findStoryTag(tags, "ABC123xyz", null)?.id).toBe("st1");
    expect(findStoryTag(tags, null, "https://instagram.com/reel/ABC123xyz/?utm=1")?.id).toBe("st1");
    expect(findStoryTag(tags, "17841400000_3412345678901234567", null)?.id).toBe("st2");
    expect(findStoryTag(tags, "nope", "https://cdn/x.jpg")).toBeNull();
    expect(findStoryTag([], "ABC123xyz", null)).toBeNull();
  });

  it("комментарий с числовым id публикации находит тег, сохранённый по ссылке на рилс", () => {
    const tags = [tag({})];
    // Без ссылки — не находится (так было до 27.10).
    expect(findStoryTag(tags, "17877618705565918", null)).toBeNull();
    const ref = {
      storyId: "17877618705565918",
      mediaUrl: null,
      permalink: "https://www.instagram.com/reel/ABC123xyz/",
    };
    expect(findStoryTagFor(tags, ref)?.id).toBe("st1");
    // Тег по числовому id находится по id, ссылка не мешает.
    const byId = [tag({ id: "st9", story_id: "17877618705565918", story_url: null })];
    expect(findStoryTagFor(byId, ref)?.id).toBe("st9");
    expect(findStoryTagFor(tags, { storyId: "1", mediaUrl: null, permalink: null })).toBeNull();
    expect(findStoryTagFor(tags, null)).toBeNull();
  });

  it("контекст для модели: товар с ценой или просьба уточнить", () => {
    expect(storyContextLine(tag({}), "ABC123xyz")).toContain("Полотенце банное»");
    expect(storyContextLine(tag({}), null)).toContain("цена 12000");
    expect(storyContextLine(null, "x")).toContain("не отмечен");
  });
});

describe("mergeLegacyStoryTags: перенос тегов v1", () => {
  const v1 = (i: number) =>
    tag({
      id: `v1-${i}`,
      story_id: `S${i}`,
      created_at: `2026-09-${String(10 + (i % 18)).padStart(2, "0")}T00:00:00Z`,
    });

  it("дописывает недостающие, а не только в пустой список", () => {
    const own = tag({ id: "own", story_id: "OWN", created_at: "2026-09-27T00:00:00Z" });
    const r = mergeLegacyStoryTags([own, v1(1)], [v1(1), v1(2), v1(3)], 200);
    expect(r.added).toBe(2);
    expect(r.dropped).toBe(0);
    expect(r.tags.map((t) => t.id).sort()).toEqual(["own", "v1-1", "v1-2", "v1-3"]);
  });

  it("тег той же сторис уже есть в v2 — остаётся версия v2", () => {
    const own = tag({ id: "own", story_id: "S2", product_name: "из v2" });
    const r = mergeLegacyStoryTags([own], [v1(2)], 200);
    expect(r.added).toBe(0);
    expect(r.tags).toEqual([own]);
  });

  it("теги v1 новее своих: свои 190 целы, из v1 влезают 10 самых новых", () => {
    const own = Array.from({ length: 190 }, (_, i) =>
      tag({ id: `own-${i}`, story_id: `O${i}`, created_at: "2026-01-01T00:00:00Z" }),
    );
    const legacy = Array.from({ length: 20 }, (_, i) =>
      tag({
        id: `v1-${i}`,
        story_id: `S${i}`,
        created_at: `2026-09-${String(1 + i).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    const r = mergeLegacyStoryTags(own, legacy, 200);
    expect(r.added).toBe(10);
    expect(r.dropped).toBe(10);
    expect(r.tags).toHaveLength(200);
    expect(r.tags.slice(0, 190)).toEqual(own);
    expect(r.tags.slice(190).map((t) => t.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `v1-${19 - i}`),
    );
  });

  it("список v2 уже полон — свои не трогаются, из v1 ничего", () => {
    const own = Array.from({ length: 200 }, (_, i) =>
      tag({ id: `own-${i}`, story_id: `O${i}`, created_at: "2020-01-01T00:00:00Z" }),
    );
    const r = mergeLegacyStoryTags(own, [tag({ id: "v1-new", story_id: "NEW" })], 200);
    expect(r).toEqual({ tags: own, added: 0, dropped: 1 });
  });

  it("повторный перенос ничего не добавляет", () => {
    const first = mergeLegacyStoryTags([], [v1(1), v1(2)], 200);
    const again = mergeLegacyStoryTags(first.tags, [v1(1), v1(2)], 200);
    expect(again.added).toBe(0);
    expect(again.tags).toEqual(first.tags);
  });

  it("больше предела — новые остаются, сколько не влезло, считается", () => {
    const legacy = Array.from({ length: 250 }, (_, i) =>
      tag({
        id: `v1-${i}`,
        story_id: `S${i}`,
        created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      }),
    );
    const r = mergeLegacyStoryTags([], legacy, 200);
    expect(r.tags).toHaveLength(200);
    expect(r.dropped).toBe(50);
    expect(r.added).toBe(200);
    expect(r.tags[0]!.id).toBe("v1-249");
    expect(r.tags.some((t) => t.id === "v1-0")).toBe(false);
  });
});

describe("несколько товаров на одной истории", () => {
  const base = {
    id: "st1",
    story_id: "Dcaih_PMAZ2",
    story_url: null,
    product_id: "p1",
    product_name: "Простыня",
    price: 30000,
    notes: null,
    created_at: "2026-09-24T00:00:00Z",
  };

  it("список из колонки products v1, без дублей; без него — один товар по старым полям", () => {
    expect(
      storyProductsOf({
        ...base,
        products: JSON.stringify([
          { id: "p1", name: "Простыня", price_kzt: 30000 },
          { id: "p2", name: "Пододеяльник", price_kzt: 45000 },
          { id: "p1", name: "Простыня", price_kzt: 30000 },
        ]),
      }),
    ).toEqual([
      { id: "p1", name: "Простыня", price: 30000 },
      { id: "p2", name: "Пододеяльник", price: 45000 },
    ]);
    expect(storyProductsOf(base)).toEqual([{ id: "p1", name: "Простыня", price: 30000 }]);
  });

  it("бот перечисляет товары истории с ценами и спрашивает, какой интересует", () => {
    const line = storyContextLine(
      {
        ...base,
        products: [
          { id: "p1", name: "Простыня", price: 30000 },
          { id: "p2", name: "Пододеяльник", price: 45000 },
        ],
      },
      "Dcaih_PMAZ2",
    );
    expect(line).toContain("«Простыня» — 30000; «Пододеяльник» — 45000");
    expect(line).toContain("уточните, какой интересует");
  });
});
