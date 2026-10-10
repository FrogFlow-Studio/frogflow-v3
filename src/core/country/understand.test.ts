import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  COUNTRY_AI_CAP_KEY,
  countryAiSpendKey,
  countryTool,
  fallbackCountry,
  parseCountryReading,
} from "./understand";
import { setCountryModelForTests, understandCountry } from "./understand.server";

const OPTIONS = [
  { code: "KZ", name: "🇰🇿 Казахстан" },
  { code: "RU", name: "🇷🇺 Россия" },
  { code: "KG", name: "🇰🇬 Кыргызстан" },
  { code: "BY", name: "🇧🇾 Беларусь" },
  { code: "UZ", name: "🇺🇿 Узбекистан" },
  { code: "OTHER", name: "🌍 Другая страна" },
];

function ctx() {
  const db = fakeDb();
  db.tables.app_settings = [];
  return { tenant: { id: "b1" }, db, timezone: "Asia/Almaty" } as unknown as TenantContext;
}

afterEach(() => {
  setCountryModelForTests(null);
  setEnvForTests(undefined);
});

describe("запасной разбор страны (без модели)", () => {
  it.each([
    ["Я из России", "RU", true],
    ["Здравствуйте, из России", "RU", true],
    ["РФ", "RU", true],
    ["Махачкала", "RU", true],
    ["кз", "KZ", true],
    ["Беларусь", "BY", true],
    ["Кыргызстан", "KG", true],
    ["Я из России, как оплатить?", "RU", false],
  ])("«%s» → %s", (text, code, only) => {
    expect(fallbackCountry(text, OPTIONS)).toEqual({ code, onlyCountry: only });
  });
  it("язык — не страна; две страны — не знаем", () => {
    expect(fallbackCountry("На русском", OPTIONS).code).toBeNull();
    expect(fallbackCountry("Русский", OPTIONS).code).toBeNull();
    expect(fallbackCountry("Казахстан или Россия", OPTIONS).code).toBeNull();
  });
  it("страны нет в списке клиента — не ставим", () => {
    expect(fallbackCountry("Я из России", [OPTIONS[0]!]).code).toBeNull();
  });
});

describe("ответ модели", () => {
  it("код — только из списка клиента", () => {
    expect(parseCountryReading({ country: "RU", answer_only: true }, OPTIONS)).toEqual({
      code: "RU",
      onlyCountry: true,
    });
    expect(parseCountryReading({ country: "US", answer_only: true }, OPTIONS).code).toBeNull();
    expect(parseCountryReading({ country: "none", answer_only: true }, OPTIONS)).toEqual({
      code: null,
      onlyCountry: false,
    });
    expect(countryTool(OPTIONS).input_schema.properties.country.enum).toContain("none");
  });

  it("понимает модель; расход дня записан", async () => {
    const c = ctx();
    const model = vi.fn(async () => ({
      input: { country: "RU", answer_only: true },
      usage: { input_tokens: 400, output_tokens: 30 },
    }));
    setCountryModelForTests(model);
    const r = await understandCountry(c, {
      text: "Дагестан",
      options: OPTIONS,
      asked: true,
      now: Date.parse("2026-10-11T00:00:00Z"),
    });
    expect(r).toEqual({ code: "RU", onlyCountry: true });
    expect(model).toHaveBeenCalledOnce();
    const spend = (c.db as ReturnType<typeof fakeDb>).tables.app_settings!.find(
      (s) => s.key === countryAiSpendKey("2026-10-11"),
    );
    expect(JSON.parse(String(spend?.value))).toEqual({ usd: 0.0011, calls: 1 });
  });

  it("потолок дня исчерпан — модель не зовём, работает запасной разбор", async () => {
    const c = ctx();
    (c.db as ReturnType<typeof fakeDb>).tables.app_settings!.push(
      { key: COUNTRY_AI_CAP_KEY, value: "0.01" },
      { key: countryAiSpendKey("2026-10-11"), value: JSON.stringify({ usd: 0.02, calls: 9 }) },
    );
    const model = vi.fn();
    setCountryModelForTests(model);
    const r = await understandCountry(c, {
      text: "Я из России",
      options: OPTIONS,
      asked: false,
      now: Date.parse("2026-10-11T00:00:00Z"),
    });
    expect(model).not.toHaveBeenCalled();
    expect(r.code).toBe("RU");
  });

  it("сбой модели — запасной разбор, покупатель не остаётся без страны", async () => {
    setCountryModelForTests(async () => {
      throw new Error("timeout");
    });
    const r = await understandCountry(ctx(), {
      text: "Беларусь",
      options: OPTIONS,
      asked: true,
    });
    expect(r).toEqual({ code: "BY", onlyCountry: true });
  });

  it("ключа ИИ нет — модель не зовём", async () => {
    setEnvForTests({});
    const r = await understandCountry(ctx(), { text: "Махачкала", options: OPTIONS, asked: true });
    expect(r.code).toBe("RU");
  });
});
