import { describe, expect, it } from "vitest";
import { zernioScenarioTexts } from "./scenario-texts.server";
import type { TenantContext } from "@/core/tenant/resolve.server";

const ctx = {
  tenant: { id: "t1", settings: { zernio: { account_ids: ["acc-1"] } } },
} as unknown as TenantContext;

describe("тексты правил Zernio для охраны «менеджер в чате»", () => {
  it("первое сообщение и варианты — только правил своих аккаунтов", async () => {
    const texts = await zernioScenarioTexts(ctx, async () => [
      {
        accountId: "acc-1",
        name: "a",
        keywords: [],
        dmMessage: "Здравствуйте! Пришлём цены",
        dmMessageVariations: ["Добрый день! Пришлём цены"],
      },
      { accountId: "other", name: "b", keywords: [], dmMessage: "Чужое правило" },
    ]);
    expect(texts).toEqual(["Здравствуйте! Пришлём цены", "Добрый день! Пришлём цены"]);
  });

  it("Zernio не ответил — пустой список, а не исключение", async () => {
    const texts = await zernioScenarioTexts(ctx, async () => {
      throw new Error("timeout");
    });
    expect(texts).toEqual([]);
  });

  it("без подключённого Zernio правила не читаются", async () => {
    let called = false;
    const none = { tenant: { id: "t2", settings: {} } } as unknown as TenantContext;
    expect(
      await zernioScenarioTexts(none, async () => {
        called = true;
        return [];
      }),
    ).toEqual([]);
    expect(called).toBe(false);
  });
});
