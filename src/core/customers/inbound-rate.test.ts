import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));
const { admitInbound, INBOUND_BUDGET } = await import("./inbound-rate");

/** Входящие от одного покупателя: порог в минуту, продавцу — одно уведомление в час. */
const ctx = () =>
  ({
    tenant: { id: "11111111-1111-1111-1111-111111111111" },
    db: fakeDb({ unique: { app_settings: [["bot_id", "key"]] } }),
  }) as unknown as TenantContext;

describe("лимит входящих от покупателя", () => {
  it("альбом из 10 фото проходит, сверх порога — отказ и одно уведомление", async () => {
    const c = ctx();
    const verdicts: string[] = [];
    for (let i = 0; i < INBOUND_BUDGET.limit + 3; i++)
      verdicts.push(await admitInbound(c, "instagram_spam"));
    expect(verdicts.slice(0, 10).every((v) => v === "ok")).toBe(true);
    expect(verdicts.filter((v) => v === "ok")).toHaveLength(INBOUND_BUDGET.limit);
    expect(verdicts.slice(INBOUND_BUDGET.limit)).toEqual(["limited_notify", "limited", "limited"]);
    // Сосед по магазину не страдает.
    expect(await admitInbound(c, "instagram_other")).toBe("ok");
  });

  it("продавец лимиту не подчиняется; проверка — только когда лимит исчерпан", async () => {
    const c = ctx();
    const exempt = vi.fn(async () => true);
    for (let i = 0; i < INBOUND_BUDGET.limit; i++) await admitInbound(c, "tg_1", exempt);
    expect(exempt).not.toHaveBeenCalled();
    expect(await admitInbound(c, "tg_1", exempt)).toBe("ok");
    expect(exempt).toHaveBeenCalledOnce();
  });
});

describe("сбой базы", () => {
  it("счётчик не записался — сообщение пропускаем, сбой уходит в журнал ошибок", async () => {
    const { reportError } = await import("@/lib/errors");
    const broken = {
      tenant: { id: "22222222-2222-2222-2222-222222222222" },
      db: {
        from: () => {
          throw new Error("база недоступна");
        },
      },
    } as unknown as TenantContext;
    expect(await admitInbound(broken, "instagram_x")).toBe("ok");
    expect(reportError).toHaveBeenCalled();
  });
});
