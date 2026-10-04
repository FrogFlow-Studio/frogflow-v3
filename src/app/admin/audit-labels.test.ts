import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANUAL_AUDIT_ACTIONS, auditedAdminAction, toAuditEntry } from "@/core/audit/admin-audit";
import { ru } from "@/app/i18n/admin/audit";

/** Все изменяющие серверные функции админки — прямо из исходников. */
function adminPostFunctions(): Array<{ name: string; filename: string }> {
  const dir = join(process.cwd(), "src/app/admin");
  const out: Array<{ name: string; filename: string }> = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".functions.ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(
      /export const (\w+) = createServerFn\(\{\s*method:\s*"POST"\s*\}\)/g,
    ))
      out.push({ name: m[1]!, filename: `src/app/admin/${f}` });
  }
  return out;
}

describe("журнал действий: у каждого действия есть подпись", () => {
  it("каждая изменяющая функция админки либо подписана в журнале, либо явно исключена", () => {
    const fns = adminPostFunctions();
    expect(fns.length).toBeGreaterThan(50);
    const audited = fns.map((f) => auditedAdminAction(f, "POST")).filter(Boolean) as string[];
    const missing = audited.filter((n) => !(`audit.action.${n}` in ru));
    expect(missing).toEqual([]);
    // И наоборот: подписи без функции — след удалённого кода.
    const labelled = Object.keys(ru)
      .filter((k) => k.startsWith("audit.action."))
      .map((k) => k.slice("audit.action.".length));
    expect(
      labelled.filter(
        (n) => !audited.includes(n) && !(MANUAL_AUDIT_ACTIONS as readonly string[]).includes(n),
      ),
    ).toEqual([]);
  });

  it("строка bot_events превращается в запись журнала", () => {
    expect(
      toAuditEntry({
        id: "e1",
        at: "2026-09-26T12:00:00Z",
        actor: "admin:masha",
        payload: { action: "saveProductFn", name: "Торт" },
      }),
    ).toEqual({
      id: "e1",
      at: "2026-09-26T12:00:00Z",
      who: "masha",
      action: "saveProductFn",
      details: { name: "Торт" },
    });
    expect(toAuditEntry({ id: "e2", at: "t", actor: "operator", payload: null })).toMatchObject({
      who: "operator",
      action: "",
      details: {},
    });
  });
});
