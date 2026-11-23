import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { loadRuleTemplate, parseRuleTemplate, saveRuleTemplate } from "./rule-template";

const BOT = "00000000-0000-0000-0000-000000000001";
const ctxOf = (db: unknown) =>
  ({ tenant: { id: BOT, settings: {} }, db }) as unknown as TenantContext;

describe("текст по умолчанию для правил Instagram", () => {
  it("сохранили — прочитали тот же текст (пробелы по краям убраны)", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    const ctx = ctxOf(db);
    expect(await loadRuleTemplate(ctx)).toEqual({ dmMessage: "", secondDmMessage: "" });
    await saveRuleTemplate(ctx, { dmMessage: "  Урок — 5 000 ₸  ", secondDmMessage: "Ссылка" });
    expect(await loadRuleTemplate(ctx)).toEqual({
      dmMessage: "Урок — 5 000 ₸",
      secondDmMessage: "Ссылка",
    });
    // Второе сохранение заменяет первое, а не добавляет строку.
    await saveRuleTemplate(ctx, { dmMessage: "Новый", secondDmMessage: "" });
    expect((await loadRuleTemplate(ctx)).dmMessage).toBe("Новый");
    expect(db.tables.app_settings).toHaveLength(1);
  });

  it("испорченное значение — пустой шаблон, а не падение формы", () => {
    expect(parseRuleTemplate("{не json")).toEqual({ dmMessage: "", secondDmMessage: "" });
    expect(parseRuleTemplate('{"dmMessage":5}')).toEqual({ dmMessage: "", secondDmMessage: "" });
  });

  it("сбой чтения — ошибка, а не «шаблона нет»", async () => {
    const failing = {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
      }),
    };
    await expect(loadRuleTemplate(ctxOf({ from: () => failing }))).rejects.toThrow();
  });
});
