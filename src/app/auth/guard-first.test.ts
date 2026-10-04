import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Замок «гвард первым»: серверная функция админки и оператора вызывается по HTTP
 * напрямую, поэтому первое же `await` в обработчике — проверка входа
 * (requireAdmin…, requireOperator или помощник файла, который их вызывает).
 * Читать данные, разбирать вход или звать другой модуль раньше гварда нельзя.
 * Открыты без входа по смыслу только вход, выход и приглашения — они в списке.
 */
const PUBLIC = new Set([
  "admin.functions.ts:adminLogin",
  "admin.functions.ts:adminLogout",
  "admin.functions.ts:adminTgLoginRequest",
  "admin.functions.ts:adminTgLoginConsume",
  "team-invite.functions.ts:staffInviteInfoFn",
  "team-invite.functions.ts:acceptStaffInviteFn",
  "operator.functions.ts:operatorLogin",
  "operator.functions.ts:operatorLogout",
]);

const GUARD_NAMES = String.raw`requireAdmin\w*|adminShops|switchAdminShop|requireOperator`;

type Fn = { dir: string; id: string; firstAwait: string | null };

/** Первое `await` обработчика (200 знаков), либо null, если его нет. */
export function firstAwaitOf(handler: string): string | null {
  // Подключение модуля одной строкой (`const { x } = await import("…");`) ничего не читает — не считается.
  const code = handler.replace(/\bawait import\("[^"]*"\);/g, "");
  const m = /\bawait\b/.exec(code);
  return m ? code.slice(m.index, m.index + 200) : null;
}

function scan(dir: string): Fn[] {
  const out: Fn[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".functions.ts"))) {
    const src = readFileSync(join(dir, file), "utf8");
    const helpers = new Set<string>();
    const guardRe = new RegExp(String.raw`\b(${GUARD_NAMES})\b`);
    for (const m of src.matchAll(/^const (\w+) = async[^\n]*(?:\n {2,}[^\n]*)*/gm))
      if (guardRe.test(m[0])) helpers.add(m[1]!);
    for (const m of src.matchAll(/^async function (\w+)\([\s\S]*?^\}/gm))
      if (guardRe.test(m[0])) helpers.add(m[1]!);
    const parts = src.split(/^export const (\w+) = createServerFn/m);
    for (let i = 1; i < parts.length; i += 2) {
      const body = parts[i + 1]!.split(/^(?:export |const |function |async function |\/\*)/m)[0]!;
      const k = body.indexOf(".handler(");
      out.push({
        dir,
        id: `${file}:${parts[i]!}`,
        firstAwait: k < 0 ? null : firstAwaitOf(body.slice(k)),
      });
    }
    // Помощники, найденные в файле, нужны проверке ниже.
    for (const f of out.filter((x) => x.id.startsWith(`${file}:`)))
      (f as Fn & { helpers?: Set<string> }).helpers = helpers;
  }
  return out;
}

const fns = [...scan("src/app/admin"), ...scan("src/app/operator")];

describe("серверные функции: гвард первым", () => {
  it("функции нашлись", () => {
    expect(fns.filter((f) => f.dir.endsWith("admin")).length).toBeGreaterThan(100);
    expect(fns.filter((f) => f.dir.endsWith("operator")).length).toBeGreaterThan(100);
  });

  for (const f of fns)
    if (!PUBLIC.has(f.id))
      it(`${f.id}: первое await — проверка входа`, () => {
        const helpers = (f as Fn & { helpers?: Set<string> }).helpers ?? new Set<string>();
        const names = [GUARD_NAMES, "guard", ...helpers].join("|");
        expect(f.firstAwait, "в обработчике нет await: гварда нет").not.toBeNull();
        expect(f.firstAwait).toMatch(new RegExp(String.raw`\b(${names})\b`));
      });

  it("находит данные до гварда", () => {
    expect(
      firstAwaitOf(".handler(async () => { const x = await db.read(); await guard(); })"),
    ).toMatch(/db\.read/);
  });
});

describe("HTTP-маршруты админки: вход проверяется", () => {
  // icon, manifest и sw отдают публичные файлы приложения, без данных магазина.
  const PUBLIC_ROUTES = new Set(["icon.ts", "manifest.ts", "sw.ts"]);
  for (const f of readdirSync("src/routes/api/admin").filter((x) => !PUBLIC_ROUTES.has(x)))
    it(`api/admin/${f} зовёт requireAdmin…`, () => {
      expect(readFileSync(join("src/routes/api/admin", f), "utf8")).toMatch(/\brequireAdmin\w*\(/);
    });
});
