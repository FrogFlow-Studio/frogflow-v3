import { describe, expect, it } from "vitest";
import { adminT } from "@/app/i18n/admin";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { taskDialog, taskReason, taskVia } from "./workspace-ui";

describe("рабочее место консультанта: задачи", () => {
  it("«Открыть диалог» ведёт в «Диалоги» панели, без чата или покупателя — наружу", () => {
    expect(taskDialog({ telegramId: 42, link: "https://ig.me/m/x" }, true)).toEqual({
      inside: 42,
    });
    expect(taskDialog({ telegramId: 42, link: "https://ig.me/m/x" }, false)).toEqual({
      outside: "https://ig.me/m/x",
    });
    expect(taskDialog({ telegramId: null, link: "https://wa.me/1" }, true)).toEqual({
      outside: "https://wa.me/1",
    });
    expect(taskDialog({ telegramId: null }, true)).toBeNull();
  });

  it("чем закрыта и причина — на 4 языках, незнакомая причина — «передача менеджеру»", () => {
    for (const l of SUPPORTED_LOCALES) {
      const t = adminT(l);
      for (const via of [
        "manual",
        "panel",
        "telegram",
        "instagram",
        "whatsapp",
        undefined,
      ] as const)
        expect(taskVia(t, { doneVia: via })).not.toMatch(/^ws\./);
      expect(taskReason(t, "что-то-новое")).toBe(t("pricelist.tasks.reason.other"));
      expect(taskReason(t, "wholesale")).not.toBe(t("pricelist.tasks.reason.other"));
    }
  });
});
