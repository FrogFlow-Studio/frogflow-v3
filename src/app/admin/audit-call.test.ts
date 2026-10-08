import { describe, expect, it, vi } from "vitest";
import { auditAdminCall, type AuditDeps } from "./audit-call";

const who = { botId: "b1", username: "masha" };
const meta = { name: "saveProductFn", filename: "src/app/admin/products.functions.ts" };

function deps(over: Partial<AuditDeps> = {}) {
  return {
    identity: vi.fn(async () => who),
    record: vi.fn(async () => {}),
    ...over,
  };
}

describe("прослойка журнала действий админки", () => {
  it("успешное изменение пишется с исполнителем, действием и входными данными", async () => {
    const d = deps();
    const r = await auditAdminCall(
      { next: async () => "ok", data: { name: "Торт" }, method: "POST", serverFnMeta: meta },
      d,
    );
    expect(r).toBe("ok");
    expect(d.record).toHaveBeenCalledWith(who, "saveProductFn", { name: "Торт" });
  });

  it("исполнитель берётся до вызова: смена своего пароля не теряет запись", async () => {
    const order: string[] = [];
    const d = deps({
      identity: vi.fn(async () => (order.push("identity"), who)),
    });
    await auditAdminCall(
      {
        next: async () => (order.push("handler"), "ok"),
        data: {},
        method: "POST",
        serverFnMeta: { ...meta, name: "saveTeamMemberFn" },
      },
      d,
    );
    expect(order).toEqual(["identity", "handler"]);
  });

  it("отказ (нет прав, ошибка) — в журнал не пишется, ошибка уходит дальше", async () => {
    const d = deps();
    await expect(
      auditAdminCall(
        {
          next: async () => {
            throw new Error("Это может изменить только владелец магазина.");
          },
          data: {},
          method: "POST",
          serverFnMeta: meta,
        },
        d,
      ),
    ).rejects.toThrow(/владелец/);
    expect(d.record).not.toHaveBeenCalled();
  });

  it("без сессии продавца — не пишется", async () => {
    const d = deps({ identity: vi.fn(async () => null) });
    await auditAdminCall({ next: async () => 1, data: {}, method: "POST", serverFnMeta: meta }, d);
    expect(d.record).not.toHaveBeenCalled();
  });

  it("чтение, заказы и чужие файлы — сессию даже не читает", async () => {
    const d = deps();
    await auditAdminCall({ next: async () => 1, data: {}, method: "GET", serverFnMeta: meta }, d);
    await auditAdminCall(
      {
        next: async () => 1,
        data: {},
        method: "POST",
        serverFnMeta: { ...meta, name: "orderActionFn" },
      },
      d,
    );
    await auditAdminCall(
      {
        next: async () => 1,
        data: {},
        method: "POST",
        serverFnMeta: { name: "setModuleFn", filename: "src/app/operator/operator.functions.ts" },
      },
      d,
    );
    expect(d.identity).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
  });

  it("ошибка записи журнала не отменяет действие", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps({
      record: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const r = await auditAdminCall(
      { next: async () => "done", data: {}, method: "POST", serverFnMeta: meta },
      d,
    );
    expect(r).toBe("done");
    warn.mockRestore();
  });
});
