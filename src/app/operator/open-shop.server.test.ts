import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** «Создать магазин» из заявки площадки: настоящие смена стадии и журнал лида на подставной базе. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
const createClient = vi.fn();
const setPlan = vi.fn();
const applyNicheTemplate = vi.fn();
vi.mock("./operator.server", () => ({ createClient }));
vi.mock("./plans.server", () => ({ setPlan }));
vi.mock("@/core/templates/apply.server", () => ({ applyNicheTemplate }));
vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: async () => ({ id: "bot-1" }),
  tenantContext: (t: unknown) => ({ tenant: t }),
}));

const { openShopFromLead } = await import("./open-shop.server");

const LEAD = "11111111-2222-4333-8444-555555555555";
const lead = (extra: Record<string, unknown> = {}) => ({
  id: LEAD,
  business_name: "Сладкая Лавка",
  phone: "77001234567",
  email: null,
  instagram_handle: null,
  source: "market_open",
  stage: "new",
  signals: "[ff-open v=confectionery t=pro l=kk] Заявка с площадки.",
  contacted_at: null,
  replied_at: null,
  ...extra,
});

beforeEach(() => {
  db = fakeDb();
  db.tables.sales_leads = [lead()];
  createClient.mockReset().mockResolvedValue("bot-1");
  setPlan.mockReset().mockResolvedValue(undefined);
  applyNicheTemplate.mockReset().mockResolvedValue(3);
});

describe("магазин из заявки", () => {
  it("создаёт клиента по нише заявки, ставит тариф и шаблон, лид становится клиентом", async () => {
    const r = await openShopFromLead(LEAD, "op");
    if (!r.ok) throw new Error(`отказ: ${r.reason}`);
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Сладкая Лавка",
        ownerId: "shop-11111111",
        vertical: "confectionery",
        ownerContact: "77001234567",
        admin: { username: "shop-11111111", password: r.shop.password },
      }),
    );
    expect(setPlan).toHaveBeenCalledWith(
      "bot-1",
      { tier: "pro", period: "month", addons: [] },
      "op",
    );
    expect(applyNicheTemplate).toHaveBeenCalledTimes(1);
    expect(db.tables.sales_leads![0]!.stage).toBe("converted");
    expect(db.tables.sales_lead_events!.map((e) => e.kind)).toEqual(["stage", "shop"]);
    expect(r.shop.warnings).toEqual([]);
    expect(r.shop.shopUrl).toBe("https://www.frogflow.tech/s/shop-11111111");
    // Сообщение на языке заявки (казахский) с логином, паролем и ссылками.
    expect(r.shop.welcome).toContain("Сәлеметсіз бе");
    expect(r.shop.welcome).toContain(r.shop.password);
    expect(r.shop.welcome).toContain("shop-11111111");
  });

  it("двойной клик: две одновременные кнопки — один магазин", async () => {
    const [a, b] = await Promise.all([openShopFromLead(LEAD, "op"), openShopFromLead(LEAD, "op")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(createClient).toHaveBeenCalledTimes(1);
    const loser = a.ok ? b : a;
    expect(loser).toEqual({ ok: false, reason: "changed" });
  });

  it("уже клиент — повторно не создаётся", async () => {
    db.tables.sales_leads = [lead({ stage: "converted" })];
    expect(await openShopFromLead(LEAD, "op")).toEqual({ ok: false, reason: "changed" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("не удалось создать магазин — лид возвращается на прежнюю стадию, оператору понятная причина", async () => {
    db.tables.sales_leads = [lead({ stage: "qualified" })];
    createClient.mockRejectedValue(new Error("Идентификатор «shop-11111111» уже занят."));
    const r = await openShopFromLead(LEAD, "op");
    expect(r).toEqual({
      ok: false,
      reason: "failed",
      message: "Идентификатор «shop-11111111» уже занят.",
    });
    expect(db.tables.sales_leads![0]!.stage).toBe("qualified");
    expect(setPlan).not.toHaveBeenCalled();
  });

  it("тариф или шаблон не вышли — магазин создан, оператор видит, что дописать", async () => {
    setPlan.mockRejectedValue(new Error("нет тарифов"));
    applyNicheTemplate.mockRejectedValue(new Error("магазин не пуст"));
    const r = await openShopFromLead(LEAD, "op");
    if (!r.ok) throw new Error("ожидали успех");
    expect(r.shop.warnings).toEqual([
      "Тариф не поставлен: нет тарифов",
      "Шаблон ниши не применён: магазин не пуст",
    ]);
    expect(db.tables.sales_leads![0]!.stage).toBe("converted");
  });

  it("чужой лид (не заявка с площадки) и несуществующий отклоняются", async () => {
    db.tables.sales_leads = [lead({ source: "hunt" })];
    expect(await openShopFromLead(LEAD, "op")).toEqual({ ok: false, reason: "not_request" });
    db.tables.sales_leads = [lead({ signals: "без отметки" })];
    expect(await openShopFromLead(LEAD, "op")).toEqual({ ok: false, reason: "not_request" });
    expect(await openShopFromLead("99999999-2222-4333-8444-555555555555", "op")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});
