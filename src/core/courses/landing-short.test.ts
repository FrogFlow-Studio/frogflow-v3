import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { cleanShort, emptyLanding, landingKey } from "./landing";
import { productByShort, saveLanding } from "./landing.server";

/**
 * Короткая ссылка курса (03.11.2026, Яков: «ссылка с длинным номером не
 * вызывает доверия»): /s/jazimei/p/kurs вместо /p/<uuid>.
 */
const T = "11111111-2222-3333-4444-555555555555";
const P1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const P2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";

beforeAll(() => setEnvForTests({}));
afterAll(() => setEnvForTests(undefined));

function shop() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.products = [
    { id: P1, bot_id: T, fulfillment_kind: "digital" },
    { id: P2, bot_id: T, fulfillment_kind: "digital" },
  ];
  db.tables.app_settings = [];
  return {
    tenant: { id: T, modules: { courses: true }, settings: {} },
    db,
  } as unknown as TenantContext;
}

describe("короткая ссылка курса", () => {
  it("латиница, цифры, дефис; регистр не важен; номер товара — не короткая ссылка", () => {
    expect(cleanShort(" Kurs ")).toBe("kurs");
    expect(cleanShort("lash-online-2")).toBe("lash-online-2");
    expect(cleanShort("курс")).toBeNull();
    expect(cleanShort("-kurs")).toBeNull();
    expect(cleanShort("k")).toBeNull();
    expect(cleanShort(P1)).toBeNull();
  });

  it("сохранённая ссылка находит курс, выключенная страница — нет", async () => {
    const ctx = shop();
    await saveLanding(ctx, P1, { ...emptyLanding(), on: true, short: "Kurs" });
    expect(await productByShort(ctx, "kurs")).toBe(P1);
    expect(await productByShort(ctx, "drugoi")).toBeNull();
    await saveLanding(ctx, P1, { ...emptyLanding(), on: false, short: "kurs" });
    expect(await productByShort(ctx, "kurs")).toBeNull();
  });

  it("занятая другим курсом ссылка не сохраняется, своя — пересохраняется", async () => {
    const ctx = shop();
    await saveLanding(ctx, P1, { ...emptyLanding(), on: true, short: "kurs" });
    await expect(
      saveLanding(ctx, P2, { ...emptyLanding(), on: true, short: "kurs" }),
    ).rejects.toThrow("уже у другого курса");
    await expect(
      saveLanding(ctx, P2, { ...emptyLanding(), on: true, short: "курс" }),
    ).rejects.toThrow("латиница");
    await saveLanding(ctx, P1, { ...emptyLanding(), on: true, short: "kurs", headline: "Новый" });
    const rows = ctx.db as unknown as { tables: { app_settings: Array<{ key: string }> } };
    expect(rows.tables.app_settings.map((r) => r.key)).toEqual([landingKey(P1)]);
  });
});
