import { describe, expect, it } from "vitest";
import { settingsFromJson } from "@/core/tenant/directory";
import { parseWizardMap } from "@/core/tenant/wizard-entry";
import { ZernioApiError } from "./errors";
import { entryChanged, evaluateWizard, explainableFailure, problemOfFailure } from "./wizard";

const ok = {
  configured: true,
  account: { expired: false },
  conflict: false,
  webhook: "ok" as const,
  testReceived: false,
};

describe("шаг мастера выводится из фактов", () => {
  it("ключа Zernio на платформе нет — шаг входа с причиной для оператора", () => {
    expect(evaluateWizard({ ...ok, configured: false })).toEqual({
      step: "login",
      problem: "not_configured",
    });
  });
  it("аккаунта нет — вход без ошибки; слетел — вход с причиной; чужой — конфликт", () => {
    expect(evaluateWizard({ ...ok, account: null })).toEqual({ step: "login" });
    expect(evaluateWizard({ ...ok, account: { expired: true } })).toEqual({
      step: "login",
      problem: "expired",
    });
    expect(evaluateWizard({ ...ok, account: null, conflict: true })).toEqual({
      step: "login",
      problem: "conflict",
    });
  });
  it("вошли: сначала вебхук, потом тест, потом готово", () => {
    expect(evaluateWizard({ ...ok, webhook: "off" })).toEqual({
      step: "webhook",
      problem: "webhook_off",
    });
    expect(evaluateWizard({ ...ok, webhook: "error" })).toEqual({
      step: "webhook",
      problem: "webhook_error",
    });
    expect(evaluateWizard(ok)).toEqual({ step: "test" });
    expect(evaluateWizard({ ...ok, testReceived: true })).toEqual({ step: "done" });
  });
});

describe("отказ Zernio → причина только через errors.ts", () => {
  const f = (status: number | null, extra: object = {}) => ({ status, ...extra });
  it("500 и обрыв — «не уверены», слепого повтора нет", () => {
    expect(problemOfFailure(f(500))).toBe("unsure");
    expect(problemOfFailure(f(null))).toBe("unsure");
  });
  it("502/503/429 и «соединение не установлено» — подождать и повторить", () => {
    expect(problemOfFailure(f(503))).toBe("try_later");
    expect(problemOfFailure(f(429))).toBe("try_later");
    expect(problemOfFailure(f(null, { code: "connect_failed" }))).toBe("try_later");
  });
  it("401/403/404 — отказ, повтор не поможет", () => {
    for (const s of [401, 403, 404]) expect(problemOfFailure(f(s))).toBe("refused");
  });
  it("объясняем только сбой Zernio; чужую ошибку не прячем", () => {
    expect(explainableFailure(new ZernioApiError("x", f(500)))).toEqual(f(500));
    expect(explainableFailure(new Error("база упала"))).toBeNull();
  });
});

describe("запись «где застряли»", () => {
  const entry = {
    step: "test",
    at: "2026-10-04T10:00:00.000Z",
    started_at: "2026-10-04T09:00:00.000Z",
  } as const;
  it("тот же шаг и та же причина — не пишем (страницу открывают часто)", () => {
    expect(entryChanged(entry, { step: "test" })).toBe(false);
    expect(entryChanged(entry, { step: "test", problem: "unsure" })).toBe(true);
    expect(entryChanged(entry, { step: "login" })).toBe(true);
    expect(entryChanged(undefined, { step: "login" })).toBe(true);
  });
  it("из jsonb берутся только известные шаги и причины; мусор отбрасывается", () => {
    const raw = {
      instagram: { ...entry, problem: "webhook_off", test_since: "2026-10-04T10:00:00.000Z" },
      whatsapp: { step: "летит", at: "x", started_at: "y" },
    };
    expect(parseWizardMap(raw)).toEqual({
      instagram: { ...entry, problem: "webhook_off", test_since: "2026-10-04T10:00:00.000Z" },
    });
    expect(parseWizardMap("мусор")).toBeUndefined();
    expect(
      parseWizardMap({ instagram: { ...entry, problem: "чужая" } })?.instagram?.problem,
    ).toBeUndefined();
  });
  it("запись переживает разбор настроек клиента", () => {
    const s = settingsFromJson({ zernio: { wizard: { instagram: entry } } });
    expect(s.zernio?.wizard?.instagram?.step).toBe("test");
  });
});
