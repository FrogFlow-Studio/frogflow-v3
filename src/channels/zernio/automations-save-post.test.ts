import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  getAutomationsMeta,
  saveAutomation,
  type AutomationApi,
  type CommentAutomation,
} from "./automations.server";

const BOT = "22222222-2222-2222-2222-222222222222";
const IG_POST = "18000000000000001";
const OLD_ZPOST = "aaaaaaaaaaaaaaaaaaaaaaaa";
const NEW_ZPOST = "bbbbbbbbbbbbbbbbbbbbbbbb";

function ctxOf() {
  const db = fakeDb({});
  db.tables.app_settings = [];
  return {
    tenant: {
      id: BOT,
      settings: {
        zernio: { profile_id: "p-1", accounts: [{ id: "acc-1", platform: "instagram" }] },
      },
      modules: { instagram: true },
    },
    db,
  } as unknown as TenantContext;
}

/** Zernio, как в проде: одно активное правило на пост, иначе 409. */
function fakeZernio(rules: CommentAutomation[], opts: { failCreate?: boolean } = {}) {
  let seq = 0;
  const api = {
    list: async () => rules.map((r) => ({ ...r })),
    create: async (body: Record<string, unknown>) => {
      if (opts.failCreate) throw new Error("Zernio API 500: boom");
      if (rules.some((r) => r.isActive !== false && r.platformPostId === body.platformPostId))
        throw new Error(
          'Zernio API 409: {"error":"An active automation already exists for this post. Deactivate it first or edit it."}',
        );
      const rule = { ...(body as CommentAutomation), id: `new-${++seq}`, isActive: true };
      rules.push(rule);
      return rule;
    },
    update: async (id: string, body: Record<string, unknown>) => {
      const r = rules.find((x) => x.id === id)!;
      Object.assign(r, body);
      return r;
    },
    remove: async (id: string) => {
      rules.splice(
        rules.findIndex((x) => x.id === id),
        1,
      );
    },
  } as unknown as AutomationApi;
  return api;
}

const rule = (over: Partial<CommentAutomation>): CommentAutomation => ({
  id: "old",
  name: "Матрешки",
  accountId: "acc-1",
  platformPostId: IG_POST,
  postId: OLD_ZPOST,
  trigger: "comment",
  keywords: [],
  dmMessage: "Здравствуйте!",
  isActive: true,
  ...over,
});

const input = {
  id: "old",
  original: { platformPostId: IG_POST, postId: OLD_ZPOST, trigger: "comment" },
  accountId: "acc-1",
  profileId: "p-1",
  name: "Матрешки",
  platformPostId: IG_POST,
  postId: NEW_ZPOST,
  keywords: ["матрешки"],
  dmMessage: "Здравствуйте! Комплект «Матрёшки»",
};

describe("Comment-to-DM: пересохранение правила на тот же пост", () => {
  it("у поста сменился id записи Zernio — правило пересоздаётся, а не падает с 409", async () => {
    const ctx = ctxOf();
    const rules = [rule({})];
    const r = await saveAutomation(ctx, input, fakeZernio(rules));
    expect(r).toEqual({ ok: true, id: "new-1" });
    expect(rules.map((x) => [x.id, x.postId, x.isActive])).toEqual([["new-1", NEW_ZPOST, true]]);
    expect(rules[0]!.dmMessage).toContain("Матрёшки");
    expect(Object.keys(await getAutomationsMeta(ctx))).toEqual(["new-1"]);
  });

  it("Zernio не создал новое — старое правило снова включено и работает", async () => {
    const rules = [rule({})];
    const r = await saveAutomation(ctxOf(), input, fakeZernio(rules, { failCreate: true }));
    expect(r.ok).toBe(false);
    expect(rules.map((x) => [x.id, x.isActive])).toEqual([["old", true]]);
  });

  it("на посте другое активное правило — понятный отказ с его названием, ничего не тронуто", async () => {
    const rules = [rule({ id: "other", name: "Палитра" })];
    const r = await saveAutomation(
      ctxOf(),
      { ...input, id: undefined, original: undefined, name: "Матрешки" },
      fakeZernio(rules),
    );
    expect(r).toMatchObject({
      ok: false,
      key: "err.instagram.postTaken",
      error:
        "На этот пост уже есть правило «Палитра». Измените его или выключите, потом сохраните это.",
    });
    expect(rules.map((x) => [x.id, x.isActive])).toEqual([["other", true]]);
  });

  it("выключенное правило на посте не мешает создать новое", async () => {
    const rules = [rule({ id: "other", isActive: false })];
    const r = await saveAutomation(
      ctxOf(),
      { ...input, id: undefined, original: undefined },
      fakeZernio(rules),
    );
    expect(r).toEqual({ ok: true, id: "new-1" });
  });
});
