import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  addSupplier,
  loadSuppliers,
  parseSuppliers,
  productSuppliers,
  removeSupplier,
  setProductSupplier,
  supplierOfKey,
  updateSupplier,
} from "./suppliers";

const BOT = "00000000-0000-0000-0000-000000000001";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [{ bot_id: BOT, key: "crm_webhook", value: "{}" }];
  db.tables.products = [
    { id: P1, bot_id: BOT },
    { id: P2, bot_id: BOT },
  ];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { db, ctx };
}

describe("поставщики склада", () => {
  it("добавить, изменить, удалить", async () => {
    const { ctx } = setup();
    expect(await loadSuppliers(ctx)).toEqual({ rev: 0, items: [] });
    const a = await addSupplier(ctx, 0, { name: " Мука-Опт ", phone: "+7700", note: "Пн–пт" });
    expect(a.rev).toBe(1);
    expect(a.items[0]).toMatchObject({ name: "Мука-Опт", phone: "+7700", contact: "" });
    const id = a.items[0]!.id;
    const b = await updateSupplier(ctx, 1, id, { name: "Мука-Опт 2", contact: "Айгуль" });
    expect(b.rev).toBe(2);
    expect(b.items).toEqual([{ id, name: "Мука-Опт 2", contact: "Айгуль", phone: "", note: "" }]);
    expect((await loadSuppliers(ctx)).items).toEqual(b.items);
    const c = await removeSupplier(ctx, 2, id);
    expect(c).toEqual({ rev: 3, items: [] });
  });

  it("без названия — отказ, ничего не записано", async () => {
    const { ctx, db } = setup();
    await expect(addSupplier(ctx, 0, { name: "  " })).rejects.toMatchObject({
      key: "err.stock.supplierName",
    });
    expect(db.tables.app_settings!.some((r) => r.key === "suppliers")).toBe(false);
  });

  it("две записи с одной версией: вторая получает «список изменился»", async () => {
    const { ctx } = setup();
    await addSupplier(ctx, 0, { name: "А" });
    // Вторая вкладка тоже видела rev 0.
    await expect(addSupplier(ctx, 0, { name: "Б" })).rejects.toMatchObject({
      key: "err.stock.suppliersChanged",
    });
    const list = await loadSuppliers(ctx);
    expect(list.items.map((s) => s.name)).toEqual(["А"]);
  });

  it("параллельные записи с одной версией: выигрывает ровно одна", async () => {
    const { ctx } = setup();
    const r = await Promise.allSettled([
      addSupplier(ctx, 0, { name: "А" }),
      addSupplier(ctx, 0, { name: "Б" }),
      addSupplier(ctx, 0, { name: "В" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await loadSuppliers(ctx)).items).toHaveLength(1);
  });

  it("правка и удаление неизвестного поставщика — отказ", async () => {
    const { ctx } = setup();
    const a = await addSupplier(ctx, 0, { name: "А" });
    const ghost = "33333333-3333-4333-8333-333333333333";
    await expect(updateSupplier(ctx, 1, ghost, { name: "Б" })).rejects.toMatchObject({
      key: "err.stock.supplierNotFound",
    });
    await expect(removeSupplier(ctx, 1, ghost)).rejects.toMatchObject({
      key: "err.stock.supplierNotFound",
    });
    expect((await loadSuppliers(ctx)).rev).toBe(a.rev);
  });

  it("удаление поставщика снимает его с товаров, чужие привязки целы", async () => {
    const { ctx, db } = setup();
    const a = await addSupplier(ctx, 0, { name: "А" });
    const b = await addSupplier(ctx, 1, { name: "Б" });
    const [sa, sb] = b.items;
    expect(a.items).toHaveLength(1);
    await setProductSupplier(ctx, P1, sa!.id);
    await setProductSupplier(ctx, P2, sb!.id);
    expect([...(await productSuppliers(ctx))]).toEqual([
      [P1, sa!.id],
      [P2, sb!.id],
    ]);
    await removeSupplier(ctx, 2, sa!.id);
    expect(db.tables.app_settings!.some((r) => r.key === supplierOfKey(P1))).toBe(false);
    expect([...(await productSuppliers(ctx))]).toEqual([[P2, sb!.id]]);
  });

  it("привязка к удалённому поставщику не считается", async () => {
    const { ctx, db } = setup();
    const a = await addSupplier(ctx, 0, { name: "А" });
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: supplierOfKey(P1),
      value: "33333333-3333-4333-8333-333333333333",
    });
    expect((await productSuppliers(ctx)).size).toBe(0);
    expect(a.items).toHaveLength(1);
  });

  it("назначить, сменить и снять поставщика товара", async () => {
    const { ctx } = setup();
    const a = await addSupplier(ctx, 0, { name: "А" });
    const b = await addSupplier(ctx, 1, { name: "Б" });
    await setProductSupplier(ctx, P1, a.items[0]!.id);
    await setProductSupplier(ctx, P1, b.items[1]!.id);
    expect((await productSuppliers(ctx)).get(P1)).toBe(b.items[1]!.id);
    await setProductSupplier(ctx, P1, null);
    expect((await productSuppliers(ctx)).size).toBe(0);
  });

  it("неизвестный товар или поставщик — отказ", async () => {
    const { ctx } = setup();
    const a = await addSupplier(ctx, 0, { name: "А" });
    await expect(
      setProductSupplier(ctx, "44444444-4444-4444-8444-444444444444", a.items[0]!.id),
    ).rejects.toMatchObject({ key: "err.stock.productNotFound" });
    await expect(
      setProductSupplier(ctx, P1, "33333333-3333-4333-8333-333333333333"),
    ).rejects.toMatchObject({ key: "err.stock.supplierNotFound" });
  });

  it("битая строка — пустой список", () => {
    expect(parseSuppliers("{не json")).toEqual({ rev: 0, items: [] });
    expect(parseSuppliers(null)).toEqual({ rev: 0, items: [] });
    expect(parseSuppliers('{"rev":2,"items":[{"id":"x","name":"А"}]}')).toEqual({
      rev: 2,
      items: [],
    });
  });
});
