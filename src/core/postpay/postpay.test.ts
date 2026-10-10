import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import {
  POSTPAY_MAX_RESENDS,
  POSTPAY_TEXT,
  costUsd,
  parseCap,
  parseDecision,
  planStep,
  postpayUserPrompt,
  type PostPayFacts,
} from "./postpay";

const facts = (o: Partial<PostPayFacts> = {}): PostPayFacts => ({
  orderId: 4132,
  orderNo: 82,
  status: "delivered",
  items: ["Палитра"],
  email: "anna@mail.ru",
  emailSentAt: "2026-10-10T04:41:00Z",
  emailFailed: false,
  resends: 0,
  ...o,
});

describe("parseDecision", () => {
  it("почта — только та, что в сообщении покупателя", () => {
    expect(parseDecision({ action: "resend", email: "x@y.ru" }, "отправьте ещё раз")).toEqual({
      action: "resend",
      email: null,
    });
    expect(parseDecision({ action: "resend", email: "" }, "вот почта New@Mail.ru")).toEqual({
      action: "resend",
      email: "new@mail.ru",
    });
    expect(
      parseDecision({ action: "resend", email: "other@mail.ru" }, "вот почта new@mail.ru").email,
    ).toBeNull();
  });
  it("непонятный ответ модели — pass", () => {
    expect(parseDecision(null, "x").action).toBe("pass");
    expect(parseDecision({ action: "reply" }, "x").action).toBe("pass");
  });
});

describe("planStep", () => {
  it("письмо ушло, покупатель спрашивает — сказать куда, не слать", () => {
    expect(planStep({ action: "status", email: null }, facts())).toMatchObject({
      kind: "told_sent",
      email: "anna@mail.ru",
    });
  });
  it("почты нет — спросить", () => {
    expect(planStep({ action: "status", email: null }, facts({ email: null })).kind).toBe(
      "ask_email",
    );
    expect(planStep({ action: "resend", email: null }, facts({ email: null })).kind).toBe(
      "ask_email",
    );
  });
  it("почта есть, письма не было — отправить", () => {
    expect(planStep({ action: "status", email: null }, facts({ emailSentAt: null }))).toEqual({
      kind: "send",
      email: "anna@mail.ru",
      fresh: false,
    });
  });
  it("не пришло — отправить ещё раз; новый адрес — на него", () => {
    expect(planStep({ action: "resend", email: null }, facts()).kind).toBe("send");
    expect(planStep({ action: "status", email: "new@mail.ru" }, facts())).toEqual({
      kind: "send",
      email: "new@mail.ru",
      fresh: true,
    });
  });
  it("писем уже много — продавцу", () => {
    expect(
      planStep({ action: "resend", email: null }, facts({ resends: POSTPAY_MAX_RESENDS })).kind,
    ).toBe("limit");
  });
  it("заказ ещё не выдан — материалы придут после подтверждения; новая почта записывается", () => {
    const f = facts({ status: "awaiting_confirmation", emailSentAt: null });
    expect(planStep({ action: "resend", email: null }, f)).toEqual({
      kind: "pending",
      email: "anna@mail.ru",
    });
    expect(planStep({ action: "status", email: "new@mail.ru" }, f)).toEqual({
      kind: "save_for_later",
      email: "new@mail.ru",
    });
    expect(planStep({ action: "status", email: null }, { ...f, email: null }).kind).toBe(
      "ask_email",
    );
  });
  it("pass — pass", () => {
    expect(planStep({ action: "pass", email: "a@b.ru" }, facts()).kind).toBe("pass");
  });
});

describe("тексты и расход", () => {
  it("все четыре языка, адрес в тексте", () => {
    for (const l of SUPPORTED_LOCALES) {
      const t = POSTPAY_TEXT[l];
      expect(t.toldSent("a@b.ru", "10.10 09:41")).toContain("a@b.ru");
      expect(t.sent("a@b.ru")).toContain("a@b.ru");
      expect(t.askEmail(82)).toContain("82");
    }
  });
  it("промпт короткий: история и факты, без лишнего", () => {
    const p = postpayUserPrompt({
      facts: facts(),
      lines: [{ sender: "customer", text: "Отправьте на почту", at: "2026-10-10T04:41:30Z" }],
      text: "Отправьте на почту",
      timezone: "Asia/Almaty",
      now: Date.parse("2026-10-10T04:42:00Z"),
    });
    expect(p).toContain("№82");
    expect(p).toContain("письмо с материалами ушло 10.10, 09:41");
    expect(p.length).toBeLessThan(1000);
  });
  it("цена Sonnet 5 и потолок", () => {
    expect(costUsd({ input_tokens: 1000, output_tokens: 30 })).toBeCloseTo(0.0023, 6);
    expect(parseCap(null)).toBe(0.5);
    expect(parseCap("0")).toBe(0);
    expect(parseCap("abc")).toBe(0.5);
  });
});
