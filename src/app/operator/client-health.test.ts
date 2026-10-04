import { describe, expect, it } from "vitest";
import {
  channelStates,
  debtByClient,
  isPaymentSoon,
  isProblem,
  lastError,
  planLabel,
  type HealthClient,
} from "./client-health";

const base: HealthClient = {
  servedBy: "v2",
  plan: "digital.pro",
  telegram: { connected: true, webhookOk: true },
  zernio: { accounts: [] },
  health: { ok: true, error: null },
  subscription: { state: "ok", daysLeft: 60 },
};
const c = (p: Partial<HealthClient>): HealthClient => ({ ...base, ...p });

describe("planLabel", () => {
  it("название уровня, индивидуальный и пусто", () => {
    expect(planLabel("digital.pro")).toBe("Pro");
    expect(planLabel("shop.business")).toBe("Business");
    expect(planLabel("custom")).toBe("Индивидуальный");
    expect(planLabel(null)).toBe("—");
  });
});

describe("channelStates", () => {
  it("здоровый Telegram v2 — зелёный", () => {
    expect(channelStates(base)).toEqual([
      { key: "telegram", label: "Telegram", tone: "ok", hint: "" },
    ]);
  });
  it("вебхук не привязан или сбой проверки — красный с причиной", () => {
    const a = channelStates(c({ telegram: { connected: true, webhookOk: false } }))[0]!;
    expect(a.tone).toBe("danger");
    expect(a.hint).toBe("вебхук не привязан");
    const b = channelStates(c({ health: { ok: false, error: "Wrong response: 502" } }))[0]!;
    expect(b).toMatchObject({ tone: "danger", hint: "Wrong response: 502" });
  });
  it("клиент v1 и клиент без токена — серые, не зелёные и не красные", () => {
    expect(channelStates(c({ servedBy: "v1" }))[0]).toMatchObject({
      tone: "neutral",
      hint: "обслуживает v1",
    });
    expect(channelStates(c({ telegram: { connected: false, webhookOk: false } }))[0]).toMatchObject(
      { tone: "neutral", hint: "не подключён" },
    );
  });
  it("Instagram и WhatsApp: показаны только подключённые, истёкший — красный", () => {
    const s = channelStates(
      c({
        zernio: {
          accounts: [
            { platform: "instagram", expired: false },
            { platform: "whatsapp", expired: true },
          ],
        },
      }),
    );
    expect(s.map((x) => [x.key, x.tone])).toEqual([
      ["telegram", "ok"],
      ["instagram", "ok"],
      ["whatsapp", "danger"],
    ]);
  });
});

describe("проблемный и «оплата скоро»", () => {
  it("красный канал или просрочка — проблемный; здоровый — нет", () => {
    expect(isProblem(base)).toBe(false);
    expect(isProblem(c({ telegram: { connected: true, webhookOk: false } }))).toBe(true);
    expect(isProblem(c({ subscription: { state: "overdue", daysLeft: -2 } }))).toBe(true);
    expect(isProblem(c({ subscription: { state: "grace_over", daysLeft: -30 } }))).toBe(true);
    // Серый Telegram у клиента v1 — не проблема.
    expect(isProblem(c({ servedBy: "v1" }))).toBe(false);
  });
  it("последняя ошибка — первая красная причина", () => {
    expect(lastError(base)).toBeNull();
    expect(lastError(c({ zernio: { accounts: [{ platform: "instagram", expired: true }] } }))).toBe(
      "Instagram: авторизация аккаунта истекла",
    );
  });
  it("оплата скоро: 0–14 дней до конца; позже и просрочка — нет", () => {
    expect(isPaymentSoon(c({ subscription: { state: "ok", daysLeft: 14 } }))).toBe(true);
    expect(isPaymentSoon(c({ subscription: { state: "expiring", daysLeft: 0 } }))).toBe(true);
    expect(isPaymentSoon(c({ subscription: { state: "ok", daysLeft: 15 } }))).toBe(false);
    expect(isPaymentSoon(c({ subscription: { state: "overdue", daysLeft: -1 } }))).toBe(false);
    expect(isPaymentSoon(c({ subscription: { state: "no_data", daysLeft: null } }))).toBe(false);
  });
});

describe("debtByClient", () => {
  it("суммирует счета по клиентам, суммы из базы приходят строками", () => {
    const m = debtByClient([
      { bot_id: "a", amount: "9900" },
      { bot_id: "a", amount: 19900 },
      { bot_id: "b", amount: "100" },
    ]);
    expect(m.get("a")).toEqual({ amount: 29800, count: 2 });
    expect(m.get("b")).toEqual({ amount: 100, count: 1 });
    expect(m.get("c")).toBeUndefined();
  });
});
