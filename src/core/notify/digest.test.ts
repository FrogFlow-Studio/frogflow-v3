import { describe, expect, it } from "vitest";
import { defaultNotifyPrefs } from "./prefs";
import { digestDue, renderDigest } from "./digest";

describe("дайджест продавцу", () => {
  it("шлётся в свой час по поясу и не дважды в день", () => {
    const p = { ...defaultNotifyPrefs(), digest: { enabled: true, hour: 9 } };
    const nineAlmaty = new Date("2026-09-26T04:15:00Z");
    expect(digestDue(p, nineAlmaty, "Asia/Almaty", null, "2026-09-26")).toBe(true);
    expect(digestDue(p, nineAlmaty, "Asia/Almaty", "2026-09-26", "2026-09-26")).toBe(false);
    expect(digestDue(p, new Date("2026-09-26T06:15:00Z"), "Asia/Almaty", null, "2026-09-26")).toBe(
      false,
    );
    expect(digestDue(defaultNotifyPrefs(), nineAlmaty, "Asia/Almaty", null, "2026-09-26")).toBe(
      false,
    );
  });
  it("сводка: заказы, ожидание, недоставленное и отложенные строки", () => {
    const text = renderDigest(
      "25.09",
      {
        ordersYesterday: 3,
        revenueYesterday: { total: 15000, currency: "KZT" },
        awaitingConfirmation: 2,
        undelivered: 1,
      },
      [{ id: "1", kind: "question", text: "🙋 Клиент ждёт менеджера\nподробности", at: "" }],
    );
    expect(text).toContain("Заказов: 3 на 15000 KZT");
    expect(text).toContain("Ждут подтверждения: 2");
    expect(text).toContain("Не доставлено сообщений: 1");
    expect(text).toContain("• 🙋 Клиент ждёт менеджера");
    expect(text).not.toContain("подробности");
  });
});
