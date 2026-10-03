import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { utcToZonedLocal, zonedLocalToUtc } from "@/core/export/csv";
import { endOfferNow, saveOfferForm, type OfferForm } from "./admin";
import { OFFERS_KEY, OFFERS_MAX, listOffers, resetOffersCache } from "./offers";

const BOT = "00000000-0000-0000-0000-0000000000a2";
const P1 = "11111111-1111-4111-8111-111111111111";
const CAT = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-05T10:00:00Z");

function setup(initial: unknown[] = []) {
  const db = fakeDb();
  db.tables.app_settings = [{ bot_id: BOT, key: OFFERS_KEY, value: JSON.stringify(initial) }];
  db.tables.order_items = [];
  db.tables.products = [{ id: P1, bot_id: BOT, price: 10000, currency: "KZT" }];
  return {
    db,
    ctx: {
      tenant: { id: BOT, modules: { limited_offers: true } },
      db,
      timezone: "Asia/Almaty",
    } as unknown as TenantContext,
  };
}
const stored = (db: ReturnType<typeof fakeDb>) =>
  JSON.parse(String(db.tables.app_settings!.find((r) => r.key === OFFERS_KEY)!.value));

const form = (over: Partial<OfferForm> = {}): OfferForm => ({
  scope: "product",
  productId: P1,
  mode: "percent",
  percent: 20,
  startsAt: null,
  endsAt: "2026-10-12T23:59",
  limit: null,
  ...over,
});

beforeEach(() => resetOffersCache());

describe("админка акций", () => {
  it("срок вводится по часам магазина: 23:59 в Алматы — это 18:59 UTC", async () => {
    expect(zonedLocalToUtc("2026-10-12T23:59", "Asia/Almaty")).toBe("2026-10-12T18:59:00.000Z");
    expect(utcToZonedLocal("2026-10-12T18:59:00.000Z", "Asia/Almaty")).toBe("2026-10-12T23:59");
    const { ctx, db } = setup();
    await saveOfferForm(ctx, form(), NOW);
    expect(stored(db)[0].ends_at).toBe("2026-10-12T18:59:00.000Z");
  });

  it("акция на категорию: без лимита штук; новая цена для неё запрещена", async () => {
    const { ctx, db } = setup();
    await saveOfferForm(ctx, form({ scope: "category", categoryId: CAT, limit: 5 }), NOW);
    expect(stored(db)[0]).toMatchObject({ category_id: CAT, product_id: "", limit: null });
    await expect(
      saveOfferForm(
        ctx,
        form({ scope: "category", categoryId: CAT, mode: "price", newPrice: 5 }),
        NOW,
      ),
    ).rejects.toMatchObject({ key: "err.admin.offerPriceScope" });
  });

  it("новая цена считается от цены товара и обязана быть ниже неё", async () => {
    const { ctx, db } = setup();
    await saveOfferForm(ctx, form({ mode: "price", newPrice: 7500, percent: undefined }), NOW);
    expect(stored(db)[0]).toMatchObject({ new_price: 7500, percent: 25 });
    await expect(
      saveOfferForm(ctx, form({ mode: "price", newPrice: 10000, percent: undefined }), NOW),
    ).rejects.toMatchObject({ key: "err.admin.offerPriceHigher" });
  });

  it("правка меняет акцию на месте, а не добавляет вторую", async () => {
    const { ctx, db } = setup();
    const a = await saveOfferForm(ctx, form(), NOW);
    await saveOfferForm(ctx, form({ id: a.id, percent: 30 }), NOW);
    expect(stored(db)).toHaveLength(1);
    expect(stored(db)[0]).toMatchObject({ id: a.id, percent: 30 });
  });

  it("правка после «Позвать покупателей» не стирает отметку рассылки", async () => {
    const { ctx, db } = setup();
    const a = await saveOfferForm(ctx, form(), NOW);
    const all = stored(db);
    all[0].broadcast_id = "b-1";
    all[0].announced_at = "2026-10-05T10:00:00.000Z";
    db.tables.app_settings!.find((r) => r.key === OFFERS_KEY)!.value = JSON.stringify(all);
    await saveOfferForm(ctx, form({ id: a.id, endsAt: "2026-10-14T23:59" }), NOW);
    expect(stored(db)[0]).toMatchObject({
      id: a.id,
      broadcast_id: "b-1",
      announced_at: "2026-10-05T10:00:00.000Z",
    });
  });

  it("две правки одновременно: обе акции на месте, ни одна не затёрта", async () => {
    const { ctx, db } = setup();
    await Promise.all([
      saveOfferForm(ctx, form({ title: "А" }), NOW),
      saveOfferForm(ctx, form({ title: "Б" }), NOW),
    ]);
    expect(
      stored(db)
        .map((o: { title: string }) => o.title)
        .sort(),
    ).toEqual(["А", "Б"]);
  });

  it("конец раньше начала — отказ", async () => {
    const { ctx } = setup();
    await expect(
      saveOfferForm(ctx, form({ startsAt: "2026-10-13T10:00" }), NOW),
    ).rejects.toMatchObject({ key: "err.admin.offerEnd" });
  });

  it("список не обрезается молча: переполнение — понятная ошибка", async () => {
    const full = Array.from({ length: OFFERS_MAX }, (_, i) => ({
      id: `o${i}`,
      product_id: P1,
      percent: 10,
      starts_at: "2026-10-01T00:00:00Z",
      ends_at: "2026-10-30T00:00:00Z",
      limit: null,
    }));
    const { ctx, db } = setup(full);
    await expect(saveOfferForm(ctx, form(), NOW)).rejects.toMatchObject({
      key: "err.admin.offersFull",
    });
    expect(stored(db)).toHaveLength(OFFERS_MAX);
  });

  it("досрочное окончание: идущая кончается сейчас, ещё не начатая убирается", async () => {
    const { ctx, db } = setup();
    const run = await saveOfferForm(ctx, form(), NOW);
    const later = await saveOfferForm(ctx, form({ startsAt: "2026-10-08T10:00" }), NOW);
    await endOfferNow(ctx, run.id, NOW);
    await endOfferNow(ctx, later.id, NOW);
    const left = stored(db);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: run.id, ends_at: NOW.toISOString() });
    // Идущей больше нет: в списке она «закончилась».
    resetOffersCache();
    expect((await listOffers(ctx))[0]!.ends_at).toBe(NOW.toISOString());
  });
});
