import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Роль «бухгалтер»: какие серверные функции админки ему открыты. Гварды
 * (guards.server) отказывают бухгалтеру везде, кроме requireAdminFinance и
 * шапки (adminShops) — это проверено в auth/accountant.test.ts. Здесь —
 * что каждая серверная функция стоит за гвардом и что открытых бухгалтеру
 * ровно столько, сколько в списке: новая функция закрыта ему сама собой,
 * а открыть её можно только осознанно, дописав сюда.
 */
const OPEN_TO_ACCOUNTANT = new Set([
  "admin.functions.ts:adminShopFn",
  "admin.functions.ts:adminShopsFn",
  "admin.functions.ts:dashboardFn",
  "admin.functions.ts:ordersFn",
  "admin.functions.ts:ordersStampFn",
  "admin.functions.ts:adminSearchFn",
  "admin.functions.ts:orderFn",
  "admin.functions.ts:analyticsFn",
  "admin.functions.ts:billingHistoryFn",
  "cost.functions.ts:costListFn",
  "cost.functions.ts:productCostFn",
  "cost.functions.ts:saveCostFn",
  "cost.functions.ts:profitFn",
]);
/** Без сессии продавца по смыслу: вход и выход. */
const PUBLIC = new Set([
  "admin.functions.ts:adminLogin",
  "admin.functions.ts:adminLogout",
  "admin.functions.ts:adminTgLoginRequest",
  "admin.functions.ts:adminTgLoginConsume",
]);

const DENY =
  /\b(requireAdmin|requireAdminRole|requireAdminModule|requireAdminAnyModule|switchAdminShop)\b/;
const OPEN = /\b(requireAdminFinance|adminShops)\b/;

const DIR = "src/app/admin";
type Fn = { id: string; body: string; guard: "deny" | "open" | "none" };

function serverFns(): Fn[] {
  const out: Fn[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".functions.ts"))) {
    const src = readFileSync(join(DIR, file), "utf8");
    // Помощники файла вида `const admin = async () => ...requireAdmin()`.
    const helpers = new Map<string, "deny" | "open">();
    // …и `async function reviewOrFail(id) { ...requireAdminModule(...) }`.
    const defs = [
      ...src.matchAll(/^const (\w+) = async[^\n]*(?:\n {2,}[^\n]*)*/gm),
      ...src.matchAll(/^async function (\w+)\([\s\S]*?^\}/gm),
    ];
    for (const m of defs) {
      if (OPEN.test(m[0])) helpers.set(m[1]!, "open");
      else if (DENY.test(m[0])) helpers.set(m[1]!, "deny");
    }
    const parts = src.split(/^export const (\w+) = createServerFn/m);
    for (let i = 1; i < parts.length; i += 2) {
      const name = parts[i]!;
      const body = parts[i + 1]!.split(/^(?:export |const |function |async function |\/\*)/m)[0]!;
      const calls = [...helpers].filter(([h]) => new RegExp(`\\b${h}\\(`).test(body));
      const guard: Fn["guard"] =
        OPEN.test(body) || calls.some(([, k]) => k === "open")
          ? "open"
          : DENY.test(body) || calls.length
            ? "deny"
            : "none";
      out.push({ id: `${file}:${name}`, body, guard });
    }
  }
  return out;
}

const fns = serverFns();

describe("бухгалтер: серверные функции админки", () => {
  it("функции нашлись", () => {
    expect(fns.length).toBeGreaterThan(100);
  });

  it("открыты бухгалтеру ровно те, что в списке", () => {
    expect(
      fns
        .filter((f) => f.guard === "open")
        .map((f) => f.id)
        .sort(),
    ).toEqual([...OPEN_TO_ACCOUNTANT].sort());
  });

  for (const f of fns)
    if (!OPEN_TO_ACCOUNTANT.has(f.id) && !PUBLIC.has(f.id))
      it(`${f.id} закрыта для бухгалтера`, () => {
        expect(f.guard).toBe("deny");
      });
});
