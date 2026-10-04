import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import {
  QUIZ_ANSWERS,
  QUIZ_EXPECTED,
  QUIZ_JSON,
  QUIZ_TENANT,
  quizProducts,
} from "../../../tests/quiz-fixture";
import type { Tenant } from "@/core/tenant/types";

/** Квиз на витрине: тот же подсчёт, что в Telegram и Direct; клиент v1, архив, без модуля — «не найден». */
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse: (d: unknown) => unknown = (d) => d;
    const b = {
      validator(v: (d: unknown) => unknown) {
        parse = v;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        return (a: { data: unknown }) => h({ data: parse(a.data) });
      },
    };
    return b;
  },
}));
let tenant: Tenant;
const db = fakeDb();
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => tenant,
  tenantContext: (t: Tenant) => ({ tenant: t, db, timezone: "Asia/Almaty" }),
}));
// Карточки витрины — отдельная забота (toStoreProduct); здесь важен порядок и состав id.
vi.mock("@/core/storefront/catalog", () => ({
  storeProductsByIds: async (_c: unknown, ids: string[]) => ids.map((id) => ({ id })),
}));

const { storeQuizFn, storeQuizResultFn } = await import("./quiz.functions");
const base = {
  id: QUIZ_TENANT,
  archived: false,
  modules: { shop: true, web_storefront: true, quiz: true, stock: true },
  settings: { served_by: "v2", slug: "shop" },
} as unknown as Tenant;

function seed() {
  db.tables.app_settings = [{ bot_id: QUIZ_TENANT, key: "quiz", value: QUIZ_JSON }];
  db.tables.products = quizProducts();
}

describe("квиз на витрине", () => {
  it("вопросы без тегов", async () => {
    seed();
    tenant = base;
    const q = await storeQuizFn({ data: { slug: "shop" } });
    expect(q.intro).toBe("Подберём за минуту");
    expect(q.questions).toHaveLength(2);
    expect(JSON.stringify(q)).not.toContain("тег");
    expect(q.questions[0]!.options).toEqual([{ label: "Детям" }, { label: "Взрослым" }]);
  });

  it("те же ответы, что в Telegram и Direct, — те же товары в том же порядке", async () => {
    seed();
    tenant = base;
    const r = await storeQuizResultFn({ data: { slug: "shop", answers: QUIZ_ANSWERS } });
    expect(r.map((p) => p.id)).toEqual(QUIZ_EXPECTED);
  });

  it("неполный набор ответов и несуществующий вариант — отказ, а не пустой подбор", async () => {
    seed();
    tenant = base;
    await expect(storeQuizResultFn({ data: { slug: "shop", answers: [0] } })).rejects.toBeTruthy();
    await expect(
      storeQuizResultFn({ data: { slug: "shop", answers: [0, 5] } }),
    ).rejects.toBeTruthy();
  });

  it.each([
    ["клиент прежней платформы", { ...base, settings: { slug: "shop" } }],
    ["архив", { ...base, archived: true }],
    ["модуль quiz выключен", { ...base, modules: { shop: true, web_storefront: true } }],
    ["нет витрины", { ...base, modules: { shop: true, quiz: true } }],
  ])("%s — «не найден»", async (_n, t) => {
    seed();
    tenant = t as unknown as Tenant;
    await expect(storeQuizFn({ data: { slug: "shop" } })).rejects.toBeTruthy();
    await expect(
      storeQuizResultFn({ data: { slug: "shop", answers: QUIZ_ANSWERS } }),
    ).rejects.toBeTruthy();
  });
});
