import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { takeWeb, WEB_BUDGETS, webSubject } from "./checkout-guard";
import { RATE_LIMIT_PREFIX } from "./rate-limit";

describe("лимиты оформления на сайте — общие, в базе", () => {
  it("счёт на почту идёт в app_settings отпечатком, без самой почты; лишнее — отказ", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    const ctx = {
      tenant: { id: `bot-${Math.random()}` },
      db,
    } as unknown as TenantContext;
    const n = WEB_BUDGETS.checkoutEmail.limit;
    const res = [];
    for (let i = 0; i <= n; i++) res.push(await takeWeb(ctx, "checkoutEmail", "anna@mail.ru"));
    expect(res).toEqual([...Array<boolean>(n).fill(true), false]);
    const keys = db.tables.app_settings!.map((r) => String(r.key));
    expect(keys).toEqual([`${RATE_LIMIT_PREFIX}web_checkoutEmail:${webSubject("anna@mail.ru")}`]);
    expect(keys[0]).not.toContain("anna");
    // Другая почта — свой счёт.
    expect(await takeWeb(ctx, "checkoutEmail", "boris@mail.ru")).toBe(true);
  });
});
