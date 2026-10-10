import { describe, expect, it, vi } from "vitest";
import {
  cashierPhone,
  createOrganization,
  issueApiKey,
  kaspiAuthVerifyOtp,
  PartnerUnreachable,
  payerPhone,
  planOptions,
  tariffPay,
} from "./apipay-partner";

const reply = (status: number, body: unknown) =>
  vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify(body), { status }));

describe("партнёрский API ApiPay", () => {
  it("организация: ключ партнёра в заголовке, bot_id — external_id, тайм-аут есть", async () => {
    const f = reply(201, { success: true, organization: { id: 9, is_test: true } });
    const r = await createOrganization(
      { partnerKey: "pk", fetchImpl: f },
      { botId: "b1", name: "Магазин" },
    );
    expect(r).toEqual({
      ok: true,
      body: { success: true, organization: { id: 9, is_test: true } },
    });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.apipay.kz/api/partner/organizations");
    expect((init.headers as Record<string, string>)["X-Partner-Key"]).toBe("pk");
    expect(init.signal).toBeDefined();
    expect(JSON.parse(String(init.body))).toEqual({
      external_id: "b1",
      name: "Магазин",
      business_relation: "customer",
    });
  });

  it("неверный SMS-код приходит 200 с success: false — это отказ", async () => {
    const r = await kaspiAuthVerifyOtp(
      { partnerKey: "pk", fetchImpl: reply(200, { success: false, error_code: "invalid_otp" }) },
      9,
      "1111",
    );
    expect(r).toEqual({ ok: false, status: 200, code: "invalid_otp", message: "" });
  });

  it("отказ с кодом и текстом", async () => {
    const r = await tariffPay(
      { partnerKey: "pk", fetchImpl: reply(422, { error: "kaspi_busy", message: "занят" }) },
      9,
      { tierId: "t1", months: 1, phone: "87001234567" },
    );
    expect(r).toEqual({ ok: false, status: 422, code: "kaspi_busy", message: "занят" });
  });

  it("обрыв связи — PartnerUnreachable, а не отказ: запрос мог дойти", async () => {
    await expect(
      issueApiKey(
        {
          partnerKey: "pk",
          fetchImpl: async () => {
            throw new Error("timeout");
          },
        },
        9,
        "https://x/api/kaspi/b1",
      ),
    ).rejects.toBeInstanceOf(PartnerUnreachable);
  });

  it("номера: кассир 7XXXXXXXXXX, плательщик 8XXXXXXXXXX", () => {
    expect(cashierPhone("+7 (701) 234-56-78")).toBe("77012345678");
    expect(cashierPhone("87012345678")).toBe("77012345678");
    expect(cashierPhone("7012345678")).toBe("77012345678");
    expect(cashierPhone("+7 612 345 67 89")).toBeNull();
    expect(cashierPhone("123")).toBeNull();
    expect(payerPhone("+77012345678")).toBe("87012345678");
  });

  it("тарифы: tiers или plans, без id — пропуск", () => {
    expect(
      planOptions({ tiers: [{ id: "t1", name: "Старт", monthly_price: 10000 }, { name: "?" }] }),
    ).toEqual([{ id: "t1", label: "Старт — 10000 ₸/мес" }]);
    expect(planOptions({ plans: [{ tier_id: 2 }] })).toEqual([{ id: "2", label: "2" }]);
    expect(planOptions(null)).toEqual([]);
  });
});
