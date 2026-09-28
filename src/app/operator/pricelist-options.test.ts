import { describe, expect, it, vi } from "vitest";

/** Часы и курс консультанта по прайсу у оператора: пишется только то, что потом прочтётся. */
const patches: Array<Record<string, unknown>> = [];
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<typeof import("@/core/tenant/resolve.server")>()),
  patchTenantSettings: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    patches.push(patch);
  }),
}));
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));

const { setConsultantPricelistOptions } = await import("./operator.server");
const { settingsFromJson } = await import("@/core/tenant/directory");

describe("часы и курс консультанта по прайсу", () => {
  it("сохраняет часы, источник и страницу finkaz так, что их читает settingsFromJson", async () => {
    await setConsultantPricelistOptions("b1", {
      hours: { open: 9, close: 22 },
      rateSource: "finkaz",
      rateUrl: "https://finkaz.kz/halyk-bank/exchange-rates",
    });
    const patch = patches.at(-1)!;
    const s = settingsFromJson({
      consultant_pricelist: { enabled: true, ...(patch.consultant_pricelist as object) },
    });
    expect(s.consultant_pricelist).toMatchObject({
      enabled: true,
      hours: { open: 9, close: 22 },
      rate_source: "finkaz",
      rate_url: "https://finkaz.kz/halyk-bank/exchange-rates",
    });
  });

  it("не принимает совпадающие часы и чужую страницу курса", async () => {
    await expect(
      setConsultantPricelistOptions("b1", {
        hours: { open: 10, close: 10 },
        rateSource: "vtb",
        rateUrl: "",
      }),
    ).rejects.toThrow(/Часы работы/);
    await expect(
      setConsultantPricelistOptions("b1", {
        hours: null,
        rateSource: "finkaz",
        rateUrl: "https://evil.example/rates",
      }),
    ).rejects.toThrow(/finkaz/);
  });
});
