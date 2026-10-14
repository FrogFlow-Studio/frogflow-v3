import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsFromJson } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";

/**
 * Одобрение магазина оператором (В12): без него магазин на площадке не появится никогда.
 * Настоящая запись — `patchTenantSettings` поверх строки клиента; здесь строка хранится в памяти,
 * слияние ключей — как у настоящей функции (один уровень).
 */
let raw: Record<string, unknown> = {};
vi.mock("@/core/tenant/resolve.server", () => ({
  patchTenantSettings: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(patch)) {
      const prev = raw[k];
      raw[k] =
        v && typeof v === "object" && prev && typeof prev === "object"
          ? { ...(prev as object), ...(v as object) }
          : v;
    }
  }),
  requireTenant: vi.fn(
    async () =>
      ({
        id: "b1",
        vertical: "digital",
        modules: { shop: true, web_storefront: true },
        settings: settingsFromJson(raw),
      }) as unknown as Tenant,
  ),
}));

const { setMarketplaceApproved, setMarketplaceHidden } = await import("./settings.server");

beforeEach(() => {
  raw = { served_by: "v2", slug: "aateach", note: "чужой ключ" };
});

describe("одобрение магазина для площадки", () => {
  it("продавец включил сам — оператор одобряет, магазин показывается", async () => {
    raw.marketplace = { listed: true, category: "Педагогам" };
    const v = await setMarketplaceApproved("b1", true);
    expect(v.state).toBe("visible");
    expect(raw.marketplace).toEqual({ listed: true, category: "Педагогам", approved: true });
    expect(raw.note).toBe("чужой ключ");
  });

  it("согласие получено вне админки — оператор включает показ за продавца", async () => {
    expect((await setMarketplaceApproved("b1", true, true)).state).toBe("visible");
    expect(raw.marketplace).toEqual({ listed: true, approved: true });
  });

  it("одобрение без согласия продавца показ не включает", async () => {
    expect((await setMarketplaceApproved("b1", true)).state).toBe("off");
  });

  it("снять одобрение — магазин уходит, согласие продавца остаётся", async () => {
    raw.marketplace = { listed: true, approved: true };
    expect((await setMarketplaceApproved("b1", false, true)).state).toBe("pending");
    expect(raw.marketplace).toEqual({ listed: true, approved: false });
  });

  it("скрытый оператором остаётся скрытым и после одобрения", async () => {
    await setMarketplaceHidden("b1", true, "жалоба");
    expect((await setMarketplaceApproved("b1", true, true)).state).toBe("hidden");
  });

  it("клиент прежней платформы — отказ без записи", async () => {
    raw = { served_by: "v1" };
    await expect(setMarketplaceApproved("b1", true, true)).rejects.toThrow(
      "Площадка доступна магазинам на новой платформе.",
    );
    expect(raw.marketplace).toBeUndefined();
  });
});
