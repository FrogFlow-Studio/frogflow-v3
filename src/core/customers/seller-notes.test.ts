import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ServerFailure } from "@/lib/server-failure";
import { setSellerNote, customerCard } from "./card";
import { customerPanel } from "./panel";
import { readSellerNoteVersioned, writeSellerNoteIf } from "./seller-notes";

const BOT = "11111111-1111-1111-1111-111111111111";

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.bot_users = [
    { bot_id: BOT, user_key: "tg_5", telegram_id: 5, platform: "telegram", loyalty_points: 0 },
  ];
  db.tables.orders = [];
  db.tables.app_settings = [];
  const ctx = {
    tenant: { id: BOT, modules: {}, settings: {} },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

describe("заметка и теги: одна запись для карточки и диалога", () => {
  it("правка из диалога видна в карточке, правка из карточки — в панели диалога", async () => {
    const { ctx } = setup();
    const empty = (await customerPanel(ctx, 5))!;
    expect(empty.seller).toEqual({ tags: [], note: "" });
    expect(empty.sellerVersion).toBeNull();

    // Из диалога: панель сохраняет по версии, которую прочитала.
    const a = await setSellerNote(
      ctx,
      "tg_5",
      { tags: ["vip"], note: "звонить" },
      empty.sellerVersion,
    );
    expect(a).toMatchObject({ saved: true, note: { tags: ["vip"], note: "звонить" } });
    const card = (await customerCard(ctx, "tg_5"))!;
    expect(card.seller).toEqual({ tags: ["vip"], note: "звонить" });
    expect(card.sellerVersion).toBe(a!.version);

    // Из карточки: по версии карточки — и панель её видит.
    const b = await setSellerNote(
      ctx,
      "tg_5",
      { tags: ["vip", "опт"], note: "звонить" },
      card.sellerVersion,
    );
    expect(b!.saved).toBe(true);
    const panel = (await customerPanel(ctx, 5))!;
    expect(panel.seller.tags).toEqual(["vip", "опт"]);
    expect(panel.sellerVersion).toBe(b!.version);
    expect(b!.version).not.toBe(a!.version);
  });

  it("одновременная правка не затирает: проигравший по версии получает актуальную заметку", async () => {
    const { ctx } = setup();
    const first = await setSellerNote(ctx, "tg_5", { tags: [], note: "исходная" }, null);
    const v0 = first!.version;
    // Двое открыли форму на одной версии и сохраняют одновременно.
    const [x, y] = await Promise.all([
      setSellerNote(ctx, "tg_5", { tags: ["a"], note: "от первого" }, v0),
      setSellerNote(ctx, "tg_5", { tags: ["b"], note: "от второго" }, v0),
    ]);
    expect([x!.saved, y!.saved].sort()).toEqual([false, true]);
    const winner = x!.saved ? x! : y!;
    const loser = x!.saved ? y! : x!;
    // Проигравший не записал ничего и видит победившую заметку с её версией.
    expect(loser.note).toEqual(winner.note);
    expect(loser.version).toBe(winner.version);
    expect((await readSellerNoteVersioned(ctx, "tg_5")).note).toEqual(winner.note);
  });

  it("первая запись гонкой: заметки не было у обоих — пишет один", async () => {
    const { ctx } = setup();
    const [x, y] = await Promise.all([
      setSellerNote(ctx, "tg_5", { tags: [], note: "раз" }, null),
      setSellerNote(ctx, "tg_5", { tags: [], note: "два" }, null),
    ]);
    expect([x!.saved, y!.saved].sort()).toEqual([false, true]);
  });

  it("удаление пустой заметки тоже по версии; чужую свежую не стирает", async () => {
    const { ctx, db } = setup();
    const a = (await setSellerNote(ctx, "tg_5", { tags: ["x"], note: "" }, null))!;
    const b = (await setSellerNote(ctx, "tg_5", { tags: ["y"], note: "" }, a.version))!;
    // Устаревшая форма очищает заметку по версии a — строка b остаётся.
    const stale = await setSellerNote(ctx, "tg_5", { tags: [], note: "" }, a.version);
    expect(stale).toMatchObject({ saved: false, note: { tags: ["y"], note: "" } });
    expect(db.tables.app_settings).toHaveLength(1);
    const cleared = await setSellerNote(ctx, "tg_5", { tags: [], note: "  " }, b.version);
    expect(cleared).toMatchObject({ saved: true, version: null });
    expect(db.tables.app_settings).toEqual([]);
  });

  it("версия — маленькое поле: заметка в 2000 знаков в адрес запроса не попадает", async () => {
    const { ctx } = setup();
    const long = "я".repeat(2000);
    const a = (await setSellerNote(ctx, "tg_5", { tags: [], note: long }, null))!;
    expect(a.saved).toBe(true);
    expect(a.version!.length).toBeLessThan(40);
    expect(
      (await setSellerNote(ctx, "tg_5", { tags: [], note: long + "!" }, a.version))!.saved,
    ).toBe(true);
  });

  it("сбой базы — ServerFailure, а не «заметки нет»", async () => {
    const { ctx } = setup();
    const broken: unknown = new Proxy(() => undefined, {
      get: (_t, prop) =>
        prop === "then"
          ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } })
          : () => broken,
    });
    const bad = { ...ctx, db: { from: () => broken } } as unknown as TenantContext;
    await expect(readSellerNoteVersioned(bad, "tg_5")).rejects.toBeInstanceOf(ServerFailure);
    await expect(
      writeSellerNoteIf(bad, "tg_5", { tags: ["x"], note: "" }, null),
    ).rejects.toBeInstanceOf(ServerFailure);
  });
});
