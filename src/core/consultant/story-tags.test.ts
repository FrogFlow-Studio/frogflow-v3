import { describe, expect, it } from "vitest";
import {
  extractInstagramMediaInfo,
  findStoryTag,
  storyContextLine,
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

  it("контекст для модели: товар с ценой или просьба уточнить", () => {
    expect(storyContextLine(tag({}), "ABC123xyz")).toContain("Полотенце банное»");
    expect(storyContextLine(tag({}), null)).toContain("цена 12000");
    expect(storyContextLine(null, "x")).toContain("не отмечен");
  });
});
