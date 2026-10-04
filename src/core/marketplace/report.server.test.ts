import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import { settingsFromJson } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import type { ReportInput } from "./report";

let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async (l: { value: string }) => SHOPS[l.value] ?? null,
  tenantContext: () => ({ db }),
}));

const { submitReport, describeTarget, listOpenReports, closeReport, getOpenReport } =
  await import("./report.server");
const { shownShopIds } = await import("./shops.server");

const PRODUCT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const tenant = (id: string, marketplace: Record<string, unknown> = {}) =>
  ({
    id,
    name: `Магазин ${id}`,
    vertical: "shop",
    settings: settingsFromJson({
      served_by: "v2",
      slug: id,
      marketplace: { listed: true, approved: true, ...marketplace },
    }),
  }) as unknown as Tenant;

const SHOPS: Record<string, Tenant> = {};
const shop = async (slug: string) =>
  SHOPS[slug] ? { tenant: SHOPS[slug]!, db: db as never } : null;

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  slug: "a",
  productId: null,
  reason: "fraud",
  text: "Взяли деньги и пропали",
  ...over,
});
const IP1 = "1".repeat(32);
const IP2 = "2".repeat(32);
const DEV1 = "d".repeat(32);
const DEV2 = "e".repeat(32);
const NOW = new Date("2026-10-04T10:00:00Z");
const deps = (now = NOW) => ({ shop, now: () => now });
const reports = () => (db.tables.zernio_logs ?? []).filter((r) => r.event_type === "market.report");

beforeEach(() => {
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  for (const k of Object.keys(SHOPS)) delete SHOPS[k];
  Object.assign(SHOPS, { a: tenant("a"), b: tenant("b"), c: tenant("c") });
  db.tables.products = [
    { id: PRODUCT, bot_id: "a", name: "Торт" },
    { id: "c1111111-7944-441b-8f71-503184fc0f1f", bot_id: "b", name: "Чужой" },
  ];
});

describe("жалоба на магазин", () => {
  it("записывается событием в журнал магазина: причина, текст, хеш адреса, без самого адреса", async () => {
    const r = await submitReport(input(), IP1, DEV1, deps());
    expect(r).toEqual({ status: "sent" });
    expect(reports()).toHaveLength(1);
    expect(reports()[0]).toMatchObject({
      bot_id: "a",
      status: "open",
      payload: {
        slug: "a",
        reason: "fraud",
        text: "Взяли деньги и пропали",
        reporter: IP1.slice(0, 16),
      },
    });
    expect(JSON.stringify(reports())).not.toContain(IP1);
  });

  it("с одного адреса в сутки — одна жалоба на объект, на следующий день можно снова", async () => {
    await submitReport(input(), IP1, null, deps());
    expect(await submitReport(input(), IP1, null, deps())).toEqual({ status: "duplicate" });
    expect(reports()).toHaveLength(1);
    await submitReport(input(), IP1, null, deps(new Date("2026-10-05T10:00:00Z")));
    expect(reports()).toHaveLength(2);
  });

  it("два запроса одновременно — одна жалоба", async () => {
    const r = await Promise.all([
      submitReport(input(), IP1, DEV1, deps()),
      submitReport(input(), IP1, DEV1, deps()),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual(["duplicate", "sent"]);
    expect(reports()).toHaveLength(1);
  });

  it("то же устройство с другого адреса вторую жалобу не добавляет, и её строка не остаётся", async () => {
    await submitReport(input(), IP1, DEV1, deps());
    expect(await submitReport(input(), IP2, DEV1, deps())).toEqual({ status: "duplicate" });
    expect(reports()).toHaveLength(1);
    expect(reports()[0]!.payload).toMatchObject({ reporter: IP1.slice(0, 16) });
    // другое устройство и другой адрес — это другой человек
    expect(await submitReport(input(), IP2, DEV2, deps())).toEqual({ status: "sent" });
    expect(reports()).toHaveLength(2);
  });

  it("на магазин и на его товар — две разные жалобы", async () => {
    await submitReport(input(), IP1, null, deps());
    const r = await submitReport(input({ productId: PRODUCT }), IP1, null, deps());
    expect(r).toEqual({ status: "sent" });
    expect(reports()[1]!.payload).toMatchObject({ product_id: PRODUCT, product: "Торт" });
  });

  it("товар другого магазина и неизвестный магазин — отказ без записи", async () => {
    const foreign = "c1111111-7944-441b-8f71-503184fc0f1f";
    expect(await submitReport(input({ productId: foreign }), IP1, null, deps())).toEqual({
      status: "refused",
      reason: "unknown",
    });
    expect(await submitReport(input({ slug: "нет" }), IP1, null, deps())).toEqual({
      status: "refused",
      reason: "unknown",
    });
    expect(reports()).toHaveLength(0);
  });

  it("с одного адреса за сутки не больше пяти жалоб на разные объекты", async () => {
    for (let i = 0; i < 5; i++) {
      const slug = `s${i}`;
      SHOPS[slug] = tenant(slug);
      expect((await submitReport(input({ slug }), IP1, null, deps())).status).toBe("sent");
    }
    SHOPS.s5 = tenant("s5");
    expect(await submitReport(input({ slug: "s5" }), IP1, null, deps())).toEqual({
      status: "refused",
      reason: "ip",
    });
    expect(reports()).toHaveLength(5);
    // другой адрес не затронут
    expect((await submitReport(input({ slug: "s5" }), IP2, null, deps())).status).toBe("sent");
  });

  it("не удалось прочитать журнал — ошибка, а не «можно жаловаться»", async () => {
    db = withBrokenReads(db, ["zernio_logs"]);
    await expect(submitReport(input(), IP1, null, deps())).rejects.toThrow(/лимит не прочитан/);
  });

  it("не удалось прочитать товар — ошибка, а не «товара нет»", async () => {
    db = withBrokenReads(db, ["products"]);
    await expect(submitReport(input({ productId: PRODUCT }), IP1, null, deps())).rejects.toThrow(
      /товар не прочитан/,
    );
  });
});

describe("жалобы оператору", () => {
  it("список: открытые, новые сверху, страницы без потерь и повторов", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: `id${String(i).padStart(3, "0")}`,
      bot_id: "a",
      event_type: "market.report",
      status: i % 10 === 0 ? "closed" : "open",
      created_at: `2026-10-04T10:${String(i % 60).padStart(2, "0")}:00Z`,
      payload: { slug: "a", shop: "Магазин a", reason: "fraud", text: `т${i}` },
    }));
    db.tables.zernio_logs = [
      ...rows,
      { id: "claim", bot_id: "a", event_type: "market.report.claim", status: "processed" },
    ];
    const seen: string[] = [];
    let offset: number | null = 0;
    let total = 0;
    while (offset != null) {
      const p = await listOpenReports(offset);
      total = p.total;
      seen.push(...p.reports.map((r) => r.id));
      offset = p.next;
    }
    expect(total).toBe(108);
    expect(seen).toHaveLength(108);
    expect(new Set(seen).size).toBe(108);
    expect(seen).not.toContain("claim");
  });

  it("1 000+ жалоб при потолке ответа 1000: все страницы, без потерь и повторов", async () => {
    db = fakeDb({ maxRows: 1000, unique: { zernio_logs: [["event_id"]] } });
    // Одинаковое created_at у всех: порядок страниц держит только уникальный id.
    db.tables.zernio_logs = Array.from({ length: 1230 }, (_, i) => ({
      id: `id${String(i).padStart(4, "0")}`,
      bot_id: "a",
      event_type: "market.report",
      status: "open",
      created_at: "2026-10-04T10:00:00Z",
      payload: { slug: "a", shop: "Магазин a", reason: "fraud", text: `т${i}` },
    }));
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset != null) {
      const p = await listOpenReports(offset);
      seen.push(...p.reports.map((r) => r.id));
      offset = p.next;
    }
    expect(seen).toHaveLength(1230);
    expect(new Set(seen).size).toBe(1230);
  });

  it("закрытие условное: двойной щелчок закрывает один раз, решение остаётся в строке", async () => {
    await submitReport(input(), IP1, null, deps());
    const id = reports()[0]!.id as string;
    const [x, y] = await Promise.all([
      closeReport(id, "hidden", "op", NOW),
      closeReport(id, "hidden", "op", NOW),
    ]);
    expect([x, y].sort()).toEqual([false, true]);
    expect(reports()[0]).toMatchObject({
      status: "closed",
      payload: { resolution: "hidden", resolved_by: "op", reason: "fraud" },
    });
    expect(await getOpenReport(id)).toBeNull();
    expect((await listOpenReports()).total).toBe(0);
  });

  it("не удалось прочитать жалобы — ошибка, а не «жалоб нет»", async () => {
    db = withBrokenReads(db, ["zernio_logs"]);
    await expect(listOpenReports()).rejects.toThrow(/не прочитаны/);
  });
});

describe("жалоба на товар: только у магазина, который видно на площадке (Ш1)", () => {
  // Без подмены `shop`: проверяется настоящий путь — справочник арендаторов и состояние площадки.
  const real = { now: () => NOW };
  it("товар видимого магазина — принимается", async () => {
    expect(await submitReport(input({ productId: PRODUCT }), IP1, null, real)).toEqual({
      status: "sent",
    });
    expect(reports()[0]!.payload).toMatchObject({ product_id: PRODUCT, product: "Торт" });
  });

  it("скрытый оператором, ждущий одобрения и магазин прежней платформы — отказ без записи", async () => {
    SHOPS.a = tenant("a", { hidden: true });
    SHOPS.b = tenant("b", { approved: false });
    SHOPS.c = {
      ...tenant("c"),
      settings: settingsFromJson({ slug: "c", marketplace: { listed: true, approved: true } }),
    } as Tenant;
    db.tables.products!.push({
      id: "d2222222-7944-441b-8f71-503184fc0f1f",
      bot_id: "c",
      name: "Х",
    });
    for (const [slug, productId] of [
      ["a", PRODUCT],
      ["b", "c1111111-7944-441b-8f71-503184fc0f1f"],
      ["c", "d2222222-7944-441b-8f71-503184fc0f1f"],
    ] as const) {
      expect(await submitReport(input({ slug, productId }), IP1, null, real)).toEqual({
        status: "refused",
        reason: "unknown",
      });
    }
    expect(reports()).toHaveLength(0);
  });
});

describe("скрытый магазин с площадки не показывается", () => {
  it("после решения оператора магазин выпадает из показанных, остальные остаются", () => {
    const before = [tenant("a"), tenant("b")];
    expect([...shownShopIds(before)].sort()).toEqual(["a", "b"]);
    const after = [tenant("a", { hidden: true, hidden_reason: "жалоба" }), tenant("b")];
    expect([...shownShopIds(after)]).toEqual(["b"]);
  });
});

describe("форма жалобы (reportFormFn)", () => {
  it("магазин на площадке — название, неизвестный или не на площадке — null без подсказки", async () => {
    expect(await describeTarget("a", null, { shop })).toEqual({ shop: "Магазин a", product: null });
    expect(await describeTarget("нет", null, { shop })).toBeNull();
    expect(await describeTarget("a", null, { shop: async () => null })).toBeNull();
  });

  it("товар этого магазина — название, чужой товар — null", async () => {
    expect(await describeTarget("a", PRODUCT, { shop })).toEqual({
      shop: "Магазин a",
      product: "Торт",
    });
    expect(await describeTarget("a", "c1111111-7944-441b-8f71-503184fc0f1f", { shop })).toBeNull();
  });
});
