import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { isOptedOut, optOutCommand, setOptOut } from "./opt-out";

describe("слова отписки", () => {
  it("«стоп», «Отписаться!», STOP — отписка; «подписаться» — возврат", () => {
    expect(optOutCommand("стоп")).toBe("unsubscribe");
    expect(optOutCommand("  Отписаться! ")).toBe("unsubscribe");
    expect(optOutCommand("STOP")).toBe("unsubscribe");
    expect(optOutCommand("«подписаться»")).toBe("subscribe");
    expect(optOutCommand("Subscribe")).toBe("subscribe");
  });

  it("обычные фразы — не команда", () => {
    expect(optOutCommand("стоп, а сколько стоит?")).toBeNull();
    expect(optOutCommand("хочу подписаться на курс по математике")).toBeNull();
    expect(optOutCommand("")).toBeNull();
    expect(optOutCommand(undefined)).toBeNull();
  });
});

describe("флаг opt_out", () => {
  it("ставится и снимается условной записью; повтор ничего не меняет", async () => {
    const db = fakeDb();
    db.tables.bot_users = [
      { user_key: "tg:1", platform: "telegram", telegram_id: 1, opt_out: false },
    ];
    const ctx = { tenant: { id: "b" }, db } as unknown as TenantContext;

    expect(await setOptOut(ctx, "tg:1", true)).toBe(true);
    expect(await isOptedOut(ctx, "tg:1")).toBe(true);
    expect(await setOptOut(ctx, "tg:1", true)).toBe(false);
    expect(await setOptOut(ctx, "tg:1", false)).toBe(true);
    expect(db.tables.bot_users![0]!.opt_out).toBe(false);
    expect(await setOptOut(ctx, "tg:нет", true)).toBe(false);
  });
});

describe("где слово — отписка", () => {
  it("вне оформления и после заказа — да; на шаге оформления — нет", async () => {
    const { optOutWordsApply } = await import("./opt-out");
    expect(optOutWordsApply(undefined)).toBe(true);
    expect(optOutWordsApply("idle")).toBe(true);
    expect(optOutWordsApply("awaiting_proof")).toBe(true);
    expect(optOutWordsApply("awaiting_fulfillment_date")).toBe(false);
    expect(optOutWordsApply("awaiting_contact")).toBe(false);
  });
});
