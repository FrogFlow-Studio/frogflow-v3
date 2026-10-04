import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  fromRules,
  upsellFor,
  parseRules,
  pruneUpsellRules,
  setUpsellFor,
  upsellHealth,
  upsellTargets,
} from "./upsell";

describe("апсейл — правила", () => {
  it("разбор игнорирует мусор", () => {
    expect(parseRules('{"a":["b",1,"c"],"x":"y"}')).toEqual({ a: ["b", "c"] });
    expect(parseRules("[1]")).toEqual({});
    expect(parseRules("{")).toEqual({});
  });
  it("кандидаты по порядку корзины, без дублей и без уже лежащего в корзине, с лимитом", () => {
    const rules = { a: ["b", "c", "d"], b: ["c", "e"] };
    expect(fromRules(["a"], rules)).toEqual(["b", "c", "d"]);
    expect(fromRules(["a", "b"], rules)).toEqual(["c", "d", "e"]);
    expect(fromRules(["a", "b"], rules, 2)).toEqual(["c", "d"]);
    expect(fromRules(["z"], rules)).toEqual([]);
  });
});

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "a0000000-0000-4000-8000-00000000000b";
const C = "a0000000-0000-4000-8000-00000000000c";
const D = "a0000000-0000-4000-8000-00000000000d";
const GONE = "a0000000-0000-4000-8000-0000000000ff";

function setup(rules: Record<string, string[]>) {
  const db = fakeDb({ unique: { app_settings: [["key"]] } });
  db.tables.app_settings = [
    {
      bot_id: "bot",
      key: "upsell_rules",
      value: JSON.stringify(rules),
      updated_at: "2026-10-01T00:00:00.000Z",
    },
  ];
  db.tables.products = [
    { id: A, name: "Торт", is_active: true },
    { id: B, name: "Капкейк", is_active: true },
    { id: C, name: "Скрытый", is_active: false },
    { id: D, name: "Свеча", is_active: true },
  ];
  const ctx = {
    tenant: { id: "bot", modules: { upsell: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}
const saved = (db: ReturnType<typeof setup>["db"]) =>
  JSON.parse(String(db.tables.app_settings!.find((r) => r.key === "upsell_rules")!.value));

describe("апсейл — правила, которые не работают", () => {
  it("скрытый и удалённый товар в предложениях — проблема, удалённый товар правила — тоже", async () => {
    const { ctx } = setup({ [A]: [B, C, GONE], [D]: [B], [GONE]: [B] });
    const h = await upsellHealth(ctx);
    expect(h.rules).toBe(3);
    expect(h.problems).toHaveLength(2);
    const a = h.problems.find((p) => p.productId === A)!;
    expect(a.trigger).toBe("ok");
    expect(a.dead.map((d) => [d.id, d.state])).toEqual([
      [C, "hidden"],
      [GONE, "deleted"],
    ]);
    expect(h.problems.find((p) => p.productId === GONE)!.trigger).toBe("deleted");
  });

  it("чистые правила — пустой список", async () => {
    const { ctx } = setup({ [A]: [B, D] });
    expect((await upsellHealth(ctx)).problems).toEqual([]);
  });

  it("выбранные предложения товара приходят с состоянием", async () => {
    const { ctx } = setup({ [A]: [B, C, GONE] });
    expect((await upsellTargets(ctx, A)).map((t) => [t.id, t.state])).toEqual([
      [B, "ok"],
      [C, "hidden"],
      [GONE, "deleted"],
    ]);
  });

  it("«Убрать удалённые»: удалённые уходят, скрытые остаются, правило удалённого товара — целиком", async () => {
    const { db, ctx } = setup({ [A]: [B, C, GONE], [D]: [GONE], [GONE]: [B] });
    expect(await pruneUpsellRules(ctx)).toBe(3);
    expect(saved(db)).toEqual({ [A]: [B, C] });
    // Повтор ничего не меняет и не пишет.
    const stamp = db.tables.app_settings![0]!.updated_at;
    expect(await pruneUpsellRules(ctx)).toBe(0);
    expect(db.tables.app_settings![0]!.updated_at).toBe(stamp);
  });

  it("сбой чтения товаров — ошибка, а не «всё живо» и не «удалить всё»", async () => {
    const { db, ctx } = setup({ [A]: [B, GONE] });
    const real = db.from.bind(db);
    db.from = ((t: string) =>
      t === "products"
        ? {
            select: () => ({
              in: async () => ({ data: null, error: { message: "boom" } }),
            }),
          }
        : real(t)) as typeof db.from;
    await expect(upsellHealth(ctx)).rejects.toThrow();
    await expect(pruneUpsellRules(ctx)).rejects.toThrow();
    expect(saved(db)).toEqual({ [A]: [B, GONE] });
  });

  it("запись правил не затирает чужую: проигравший читает заново и применяет свою правку к свежему", async () => {
    const { db, ctx } = setup({ [A]: [B] });
    // Между чтением и записью «кто-то другой» добавил правило D → B.
    let raced = false;
    const real = db.from.bind(db);
    db.from = ((t: string) => {
      const q = real(t) as unknown as Record<string, unknown>;
      if (t !== "app_settings" || raced) return q;
      const upd = (q.update as (v: unknown) => unknown).bind(q);
      q.update = (v: unknown) => {
        if (!raced) {
          raced = true;
          db.tables.app_settings![0] = {
            ...db.tables.app_settings![0]!,
            value: JSON.stringify({ [A]: [B], [D]: [B] }),
            updated_at: "2026-10-02T00:00:00.000Z",
          };
        }
        return upd(v);
      };
      return q;
    }) as unknown as typeof db.from;
    await setUpsellFor(ctx, A, [B, D]);
    expect(saved(db)).toEqual({ [A]: [B, D], [D]: [B] });
  });
});

describe("апсейл — запасной подбор по одобренным отзывам", () => {
  it("товар со скрытыми отзывами не обгоняет товар с одобренными, хотя колонка rating_count больше", async () => {
    const { ctx, db } = setup({});
    const E = "a0000000-0000-4000-8000-00000000000e";
    db.tables.products = [
      { id: A, name: "Торт", is_active: true, category_ids: ["c"], rating_count: 0 },
      // Спам: пять скрытых оценок, колонка считает их все.
      { id: B, name: "Спам", is_active: true, category_ids: ["c"], rating_count: 5 },
      { id: D, name: "Свеча", is_active: true, category_ids: ["c"], rating_count: 2 },
      { id: E, name: "Без отзывов", is_active: true, category_ids: ["c"], rating_count: 0 },
    ];
    const reviews = [
      ...[0, 1, 2, 3, 4].map((i) => ({ id: `s${i}`, product_id: B, rating: 1, status: "hidden" })),
      ...[0, 1].map((i) => ({ id: `g${i}`, product_id: D, rating: 5, status: "approved" })),
    ];
    db.tables.product_reviews = reviews.map(({ id, product_id, rating }) => ({
      id,
      product_id,
      rating,
      telegram_id: 1,
    }));
    for (const r of reviews)
      db.tables.app_settings!.push({
        bot_id: "bot",
        key: `review_meta:${r.id}`,
        value: JSON.stringify({ status: r.status, photos: [] }),
      });
    const out = await upsellFor(ctx, [A], 3);
    expect(out[0]!.id).toBe(D);
  });
});
