import { describe, expect, it } from "vitest";
import { deliverToEach, humanTelegramReason, NO_RECIPIENTS_REASON } from "./deliver";

describe("уведомление продавцам магазина", () => {
  it("отправляет каждому", async () => {
    const sent: string[] = [];
    const r = await deliverToEach(["111", "222", "333"], async (id) => {
      sent.push(id);
      return { ok: true };
    });
    expect(sent).toEqual(["111", "222", "333"]);
    expect(r).toMatchObject({ delivered: ["111", "222", "333"], failed: [], ok: true });
  });

  it("отказ одного не отменяет остальных и виден поимённо", async () => {
    const r = await deliverToEach(["111", "222", "333"], async (id) => {
      if (id === "222") return { ok: false, description: "Forbidden: bot was blocked by the user" };
      if (id === "333") throw new Error("fetch failed");
      return { ok: true };
    });
    expect(r.delivered).toEqual(["111"]);
    expect(r.failed.map((f) => f.id)).toEqual(["222", "333"]);
    expect(r.failed[0]!.reason).toContain("заблокировал бота");
    expect(r.ok).toBe(true);
  });

  it("если не дошло никому — это не успех", async () => {
    const r = await deliverToEach(["111", "222"], async () => ({
      ok: false,
      description: "Bad Request: chat not found",
    }));
    expect(r.ok).toBe(false);
    expect(r.noRecipients).toBe(false);
    expect(r.failed).toHaveLength(2);
  });

  it("получателей нет — говорим об этом прямо", async () => {
    let calls = 0;
    const r = await deliverToEach([], async () => {
      calls++;
      return { ok: true };
    });
    expect(calls).toBe(0);
    expect(r).toMatchObject({ ok: false, noRecipients: true, delivered: [], failed: [] });
    expect(NO_RECIPIENTS_REASON).toMatch(/получателей нет/);
  });

  it("отказы Telegram переводятся на человеческий", () => {
    expect(humanTelegramReason("Forbidden: bot was blocked by the user")).toMatch(
      /^заблокировал бота \(Forbidden/,
    );
    expect(humanTelegramReason("Bad Request: chat not found")).toMatch(/не писал боту \/start/);
    expect(humanTelegramReason("Forbidden: user is deactivated")).toMatch(
      /аккаунт Telegram удалён/,
    );
    expect(humanTelegramReason("Unauthorized")).toMatch(/токен бота недействителен/);
    expect(humanTelegramReason("retries exhausted")).toMatch(/Telegram не ответил/);
    expect(humanTelegramReason(undefined)).toMatch(/Telegram не ответил/);
    // Незнакомый отказ не прячем: показываем как есть.
    expect(humanTelegramReason("Bad Request: something new")).toBe("Bad Request: something new");
  });
});
