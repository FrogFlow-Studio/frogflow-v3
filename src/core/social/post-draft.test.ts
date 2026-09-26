import { describe, expect, it } from "vitest";
import {
  mediaTypeOf,
  postState,
  validatePostDraft,
  zernioPostBody,
  type PostDraft,
} from "./post-draft";

const NOW = new Date("2026-09-26T12:00:00Z");
const img = (n = 1) => ({ type: "image" as const, url: `https://cdn.test/${n}.jpg` });
const vid = { type: "video" as const, url: "https://cdn.test/v.mp4" };
const draft = (d: Partial<PostDraft> = {}): PostDraft => ({
  kind: "feed",
  accountIds: ["acc-1"],
  text: "Новый материал",
  media: [img()],
  ...d,
});

describe("validatePostDraft", () => {
  it("обычный пост с картинкой проходит", () => {
    expect(validatePostDraft(draft(), ["acc-1"], NOW)).toEqual([]);
  });
  it("чужой аккаунт и пустой список аккаунтов — отказ", () => {
    expect(validatePostDraft(draft({ accountIds: ["acc-2"] }), ["acc-1"], NOW)).toContain(
      "foreign_account",
    );
    expect(validatePostDraft(draft({ accountIds: [] }), ["acc-1"], NOW)).toContain("no_account");
  });
  it("без медиа Instagram не публикует; карусель — до десяти", () => {
    expect(validatePostDraft(draft({ media: [] }), ["acc-1"], NOW)).toContain("no_media");
    const eleven = Array.from({ length: 11 }, (_, i) => img(i));
    expect(validatePostDraft(draft({ media: eleven }), ["acc-1"], NOW)).toEqual(["too_many_media"]);
  });
  it("Reels — ровно одно видео, сторис — один файл", () => {
    expect(validatePostDraft(draft({ kind: "reel" }), ["acc-1"], NOW)).toEqual([
      "reel_needs_video",
    ]);
    expect(validatePostDraft(draft({ kind: "reel", media: [vid] }), ["acc-1"], NOW)).toEqual([]);
    expect(
      validatePostDraft(draft({ kind: "story", media: [img(1), img(2)] }), ["acc-1"], NOW),
    ).toEqual(["story_one_media"]);
  });
  it("подпись длиннее 2200 символов — отказ, у сторис текст не проверяется", () => {
    const long = "а".repeat(2201);
    expect(validatePostDraft(draft({ text: long }), ["acc-1"], NOW)).toEqual(["caption_too_long"]);
    expect(validatePostDraft(draft({ kind: "story", text: long }), ["acc-1"], NOW)).toEqual([]);
  });
  it("ссылка на файл только https", () => {
    expect(
      validatePostDraft(
        draft({ media: [{ type: "image", url: "http://x/1.jpg" }] }),
        ["acc-1"],
        NOW,
      ),
    ).toEqual(["bad_media_url"]);
  });
  it("отложенная публикация: не в прошлом и не дальше 30 дней", () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    expect(validatePostDraft(draft({ scheduledFor: at(-1000) }), ["acc-1"], NOW)).toEqual([
      "schedule_past",
    ]);
    expect(validatePostDraft(draft({ scheduledFor: at(31 * 86_400_000) }), ["acc-1"], NOW)).toEqual(
      ["schedule_too_far"],
    );
    expect(validatePostDraft(draft({ scheduledFor: at(3_600_000) }), ["acc-1"], NOW)).toEqual([]);
  });
});

describe("zernioPostBody", () => {
  it("пост сейчас: подпись, медиа, аккаунт на каждый id", () => {
    expect(zernioPostBody(draft({ accountIds: ["a", "b"] }))).toEqual({
      content: "Новый материал",
      mediaItems: [img()],
      platforms: [
        { platform: "instagram", accountId: "a" },
        { platform: "instagram", accountId: "b" },
      ],
      publishNow: true,
    });
  });
  it("сторис — contentType story и без подписи; отложенный — время и пояс", () => {
    const b = zernioPostBody(
      draft({ kind: "story", scheduledFor: "2026-09-27T09:00:00.000Z", timezone: "Asia/Almaty" }),
    );
    expect(b).not.toHaveProperty("content");
    expect(b).not.toHaveProperty("publishNow");
    expect(b).toMatchObject({
      scheduledFor: "2026-09-27T09:00:00.000Z",
      timezone: "Asia/Almaty",
      platforms: [{ platformSpecificData: { contentType: "story" } }],
    });
  });
  it("Reels — видео с показом в ленте", () => {
    expect(zernioPostBody(draft({ kind: "reel", media: [vid] })).platforms[0]).toEqual({
      platform: "instagram",
      accountId: "acc-1",
      platformSpecificData: { shareToFeed: true },
    });
  });
});

describe("mediaTypeOf и postState", () => {
  it("картинка и видео по типу или имени; прочее — нет", () => {
    expect(mediaTypeOf("image/png")).toBe("image");
    expect(mediaTypeOf("clip.MOV")).toBe("video");
    expect(mediaTypeOf("image/webp")).toBeNull();
  });
  it("статусы Zernio", () => {
    expect(postState("published")).toBe("published");
    expect(postState("partial")).toBe("published");
    expect(postState("scheduled")).toBe("scheduled");
    expect(postState("failed")).toBe("failed");
    expect(postState("publishing")).toBe("publishing");
    expect(postState(undefined)).toBe("publishing");
    expect(postState("deleted")).toBe("cancelled");
  });
});
