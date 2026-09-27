import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { STORY_TAGS_KEY } from "@/core/consultant/story-tags";

const db = fakeDb({ maxRows: 1000 });
let failTable: string | null = null;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => withFailure(db) }));

/** База, у которой чтение таблицы `failTable` отвечает ошибкой PostgREST. */
function withFailure(real: typeof db): typeof db {
  const failing = (): unknown =>
    new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "then"
            ? (ok: (r: unknown) => unknown) =>
                ok({ data: null, error: { message: 'relation "x" timeout' } })
            : () => failing(),
      },
    );
  return new Proxy(real, {
    get: (t, prop) =>
      prop === "from"
        ? (table: string) => (table === failTable ? failing() : t.from(table))
        : Reflect.get(t, prop),
  });
}
const { planLegacyStoryTags, storyTagsNote } = await import("./story-tags-import.server");
const { upsertStoryTag } = await import("@/core/consultant/story-tags");
const { ServerFailure } = await import("@/lib/server-failure");

const BOT = "bot-1";
const tag = (id: string, story: string, day: number) => ({
  id,
  story_id: story,
  story_url: null,
  product_id: null,
  product_name: "Товар",
  price: null,
  notes: null,
  created_at: new Date(Date.UTC(2026, 0, day)).toISOString(),
});

describe("перенос тегов сторис v1: сколько допишется и сколько не влезет", () => {
  it("100 своих в v2 и 150 из v1 — допишется 100, 50 не влезут в предел 200", async () => {
    const own = Array.from({ length: 100 }, (_, i) => tag(`own-${i}`, `O${i}`, 200 + i));
    db.tables.app_settings = [
      { bot_id: BOT, key: STORY_TAGS_KEY, value: JSON.stringify(own), updated_at: "" },
    ];
    db.tables.story_product_tags = Array.from({ length: 150 }, (_, i) => ({
      ...tag(`v1-${i}`, `S${i}`, 1 + i),
      bot_id: BOT,
      product_price_kzt: null,
    }));
    const ctx = { tenant: { id: BOT }, db } as unknown as TenantContext;
    const plan = await planLegacyStoryTags(ctx, BOT);
    expect(plan).toMatchObject({ v1: 150, v2: 100, add: 100, dropped: 50, max: 200 });
    expect(plan.merged).toHaveLength(200);
    // Свои теги продавца v2 целы, не влезли самые старые из v1.
    expect(plan.merged.filter((t) => t.id.startsWith("own-"))).toHaveLength(100);
    expect(plan.merged.some((t) => t.id === "v1-0")).toBe(false);
  });

  it("теги v1 новее своих v2 — свои остаются все, урезается только v1", async () => {
    failTable = null;
    const own = Array.from({ length: 190 }, (_, i) => tag(`own-${i}`, `O${i}`, 1));
    db.tables.app_settings = [
      { bot_id: BOT, key: STORY_TAGS_KEY, value: JSON.stringify(own), updated_at: "" },
    ];
    db.tables.story_product_tags = Array.from({ length: 20 }, (_, i) => ({
      ...tag(`v1-${i}`, `S${i}`, 100 + i),
      bot_id: BOT,
      product_price_kzt: null,
    }));
    const ctx = { tenant: { id: BOT }, db } as unknown as TenantContext;
    const plan = await planLegacyStoryTags(ctx, BOT);
    expect(plan).toMatchObject({ v1: 20, v2: 190, add: 10, dropped: 10 });
    expect(plan.merged.filter((t) => t.id.startsWith("own-"))).toHaveLength(190);
  });

  it("сбой чтения тегов v1 — ServerFailure, а не текст базы оператору", async () => {
    failTable = "story_product_tags";
    const ctx = { tenant: { id: BOT }, db } as unknown as TenantContext;
    const err = await planLegacyStoryTags(ctx, BOT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerFailure);
    failTable = null;
  });

  it("сбой чтения тегов v2 — ServerFailure, ничего не пишется", async () => {
    const own = [tag("own-1", "O1", 1)];
    const saved = JSON.stringify(own);
    db.tables.app_settings = [{ bot_id: BOT, key: STORY_TAGS_KEY, value: saved, updated_at: "" }];
    db.tables.story_product_tags = [
      { ...tag("v1-1", "S1", 2), bot_id: BOT, product_price_kzt: null },
    ];
    const failingDb = withFailure(db);
    failTable = "app_settings";
    const ctx = { tenant: { id: BOT }, db: failingDb } as unknown as TenantContext;
    await expect(planLegacyStoryTags(ctx, BOT)).rejects.toBeInstanceOf(ServerFailure);
    await expect(
      upsertStoryTag(ctx, { story: "NEWSTORY1", product_name: "Новый" }),
    ).rejects.toBeInstanceOf(ServerFailure);
    failTable = null;
    expect(db.tables.app_settings).toEqual([
      { bot_id: BOT, key: STORY_TAGS_KEY, value: saved, updated_at: "" },
    ]);
  });

  it("итог для оператора одной строкой", () => {
    expect(storyTagsNote({ added: 100, dropped: 50 })).toBe(
      "теги сторис: перенесено 100, не влезло в предел 50",
    );
    expect(storyTagsNote({ added: 3, dropped: 0 })).toBe("теги сторис: перенесено 3");
    expect(storyTagsNote({ added: 0, dropped: 0 })).toBeUndefined();
    expect(storyTagsNote({ error: "нет связи" })).toBe("теги сторис не перенесены: нет связи");
  });
});
