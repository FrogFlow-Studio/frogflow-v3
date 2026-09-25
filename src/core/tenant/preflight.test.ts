import { describe, expect, it } from "vitest";
import { evaluatePreflight, preflightBlockers } from "./preflight";

const base = {
  modulesOn: ["shop", "coupons"] as const,
  tokenPresent: true,
  tokenOk: true,
  botUsername: "demo_bot",
  paymentMethods: 2,
  products: 10,
  adminLogin: true,
  appUrl: "https://client.vercel.app",
};

describe("evaluatePreflight", () => {
  it("всё на месте — готов, с напоминанием про крон v1", () => {
    const p = evaluatePreflight({ ...base, modulesOn: [...base.modulesOn] });
    expect(p.ready).toBe(true);
    expect(p.checks.map((c) => [c.key, c.level])).toEqual([
      ["modules", "ok"],
      ["token", "ok"],
      ["payments", "ok"],
      ["products", "ok"],
      ["admin", "ok"],
      ["v1", "info"],
    ]);
    expect(p.checks[1]!.title).toContain("@demo_bot");
  });
  it("не перенесённый модуль и отсутствие токена блокируют переезд", () => {
    const p = evaluatePreflight({
      ...base,
      modulesOn: ["shop", "crypto"],
      tokenPresent: false,
      tokenOk: null,
    });
    expect(p.ready).toBe(false);
    expect(preflightBlockers(p)).toEqual(["Не все модули перенесены", "Нет токена бота"]);
  });
  it("отклонённый токен блокирует; пустые реквизиты и товары — только предупреждение", () => {
    const p = evaluatePreflight({
      ...base,
      modulesOn: ["shop"],
      tokenOk: false,
      paymentMethods: 0,
      products: 0,
      adminLogin: false,
      appUrl: null,
    });
    expect(preflightBlockers(p)).toEqual(["Токен не отвечает"]);
    expect(p.checks.filter((c) => c.level === "warn").map((c) => c.key)).toEqual([
      "payments",
      "products",
      "admin",
    ]);
    expect(p.checks.some((c) => c.key === "v1")).toBe(false);
  });
  it("Robokassa считается настроенной оплатой без реквизитов", () => {
    const p = evaluatePreflight({ ...base, modulesOn: ["shop", "robokassa"], paymentMethods: 0 });
    expect(p.checks.find((c) => c.key === "payments")?.level).toBe("ok");
  });
});
