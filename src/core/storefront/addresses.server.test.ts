import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ADDRESSES_MAX } from "./addresses";
import { deleteAddress, listAddresses, saveAddress, updateAddress } from "./addresses.server";

/** Сохранённые адреса: только у вошедшего (карточка бота), точечно, чужое и чужие поля целы. */
const BOT = "00000000-0000-0000-0000-0000000000aa";
let db: FakeDb;
const ctx = () =>
  ({ tenant: { id: BOT, modules: {}, settings: {} }, db }) as unknown as TenantContext;
const card = (key: string, tg: number, platform: string, extra: Record<string, unknown> = {}) => ({
  bot_id: BOT,
  user_key: key,
  telegram_id: tg,
  platform,
  loyalty_points: 120,
  state: { mode: "idle", web_fav: { ids: ["p1"], rev: 4 }, phone: "+77001234567" },
  ...extra,
});
const row = (key: string) => db.tables.bot_users!.find((r) => r.user_key === key)!;

beforeEach(() => {
  db = fakeDb({ unique: { bot_users: [["user_key"]] } });
  db.tables.bot_users = [
    card("tg_1001", 1001, "telegram"),
    card("tg_2002", 2002, "telegram"),
    card("web_abc", -77, "web"),
  ];
});

describe("сохранённые адреса вошедшего покупателя", () => {
  it("сохраняется, читается, меняется и удаляется; чужие поля, баллы и версия избранного целы", async () => {
    const r = await saveAddress(ctx(), 1001, "Алматы, Абая 1");
    expect(r.ok && r.items).toHaveLength(1);
    const id = r.ok ? r.items[0]!.id : "";
    expect(await listAddresses(ctx(), 1001)).toEqual([{ id, text: "Алматы, Абая 1" }]);
    await updateAddress(ctx(), 1001, id, "Астана, Мира 5");
    expect((await listAddresses(ctx(), 1001))![0]!.text).toBe("Астана, Мира 5");
    const state = row("tg_1001").state as Record<string, unknown>;
    expect(state.mode).toBe("idle");
    expect(state.phone).toBe("+77001234567");
    expect(state.web_fav).toEqual({ ids: ["p1"], rev: 4 });
    expect(row("tg_1001").loyalty_points).toBe(120);
    await deleteAddress(ctx(), 1001, id);
    expect(await listAddresses(ctx(), 1001)).toEqual([]);
  });

  it("чужой адрес не виден и не меняется: у каждого покупателя свой список", async () => {
    const mine = await saveAddress(ctx(), 1001, "Мой адрес");
    const theirs = await saveAddress(ctx(), 2002, "Чужой адрес");
    expect(await listAddresses(ctx(), 2002)).toEqual([
      { id: theirs.ok ? theirs.items[0]!.id : "", text: "Чужой адрес" },
    ]);
    // чужой id при своём входе — «unknown», чужой список не тронут
    const r = await deleteAddress(ctx(), 1001, theirs.ok ? theirs.items[0]!.id : "");
    expect(r).toEqual({ ok: false, reason: "unknown" });
    expect((await listAddresses(ctx(), 2002))!).toHaveLength(1);
    expect(mine.ok).toBe(true);
  });

  it("без входа и по карточке сайта (почта) адресов нет и записать нельзя", async () => {
    expect(await listAddresses(ctx(), 5555)).toBeNull();
    expect(await saveAddress(ctx(), 5555, "Куда-то")).toEqual({ ok: false, reason: "no_card" });
    expect(await listAddresses(ctx(), -77)).toBeNull();
    expect(await saveAddress(ctx(), -77, "Куда-то")).toEqual({ ok: false, reason: "no_card" });
    expect(row("web_abc").state).toEqual(card("web_abc", -77, "web").state);
  });

  it("два сохранения одновременно — оба на месте, предел не превышается", async () => {
    await Promise.all([saveAddress(ctx(), 1001, "Адрес A"), saveAddress(ctx(), 1001, "Адрес B")]);
    expect((await listAddresses(ctx(), 1001))!.map((i) => i.text).sort()).toEqual([
      "Адрес A",
      "Адрес B",
    ]);
    for (let i = 0; i < ADDRESSES_MAX + 2; i++) await saveAddress(ctx(), 1001, `Ещё ${i}`);
    expect(await listAddresses(ctx(), 1001)).toHaveLength(ADDRESSES_MAX);
    expect(await saveAddress(ctx(), 1001, "Лишний")).toEqual({ ok: false, reason: "full" });
  });

  it("карточка Instagram/WhatsApp тоже подходит (вход по коду)", async () => {
    db.tables.bot_users!.push(card("wa_77001234567", -999, "whatsapp"));
    expect((await saveAddress(ctx(), -999, "Алматы, 3")).ok).toBe(true);
  });
});
