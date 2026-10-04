import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * П4 (партия 20): совместные акции С5, согласие, отмена и срок в любом порядке.
 * Итог всегда один из двух: акция идёт и коды всех включены, либо она не идёт
 * (отменена или просрочена) и ни один код не включён.
 */
const db = fakeDb({
  unique: {
    promo_codes: [["bot_id", "code"]],
    joint_promo_members: [["promo_id", "bot_id"]],
  },
});
let tenants: Array<Record<string, unknown>> = [];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({ tenantDirectory: async () => tenants }));

const srv = await import("./joint.server");

const author = (id: string, name: string) => ({
  id,
  name: `Магазин ${name}`,
  modules: { coupons: true },
  settings: { served_by: "v2", slug: `shop-${id}`, community: { enabled: true, name } },
});
const ctx = (id: string) =>
  ({ tenant: tenants.find((t) => t.id === id), db }) as unknown as TenantContext;
const FUTURE = new Date(Date.now() + 10 * 86_400_000).toISOString();
const terms = (code: string, percent: number) => ({ code, percent, conditions: "" });

beforeEach(() => {
  for (const t of ["joint_promos", "joint_promo_members", "promo_codes"]) db.tables[t] = [];
  tenants = [author("a", "Аня"), author("b", "Боря"), author("c", "Цветы")];
});

const propose = (partners = ["b", "c"]) =>
  srv.createJointPromo(ctx("a"), {
    title: "Весенний дуэт",
    endsAt: FUTURE,
    partnerIds: partners,
    terms: terms("ANYA10", 10),
  });
const codes = () => db.tables.promo_codes!;
const status = () => db.tables.joint_promos![0]!.status;

/** Ни одного «хвоста»: идёт — все коды включены; не идёт — все выключены. */
function expectConsistent() {
  if (status() === "active") expect(codes().every((c) => c.is_active === true)).toBe(true);
  else expect(codes().every((c) => c.is_active === false)).toBe(true);
}

describe("согласие, отмена и срок: любой порядок", () => {
  it("отмена раньше согласия: согласиться уже нельзя, кода у отказавшегося не появилось", async () => {
    const { id } = await propose();
    await srv.declineJointPromo(ctx("c"), id);
    await expect(srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15))).rejects.toThrow(
      "уже закрыта",
    );
    expect(status()).toBe("cancelled");
    expect(codes().filter((c) => c.bot_id === "b")).toEqual([]);
    expectConsistent();
  });

  it("срок вышел до согласия: акция закрыта, коды выключены, ответа от магазина не ждём", async () => {
    const { id } = await propose();
    db.tables.joint_promos![0]!.ends_at = new Date(Date.now() - 1000).toISOString();
    await expect(srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15))).rejects.toThrow(
      "уже закрыта",
    );
    expect(codes().filter((c) => c.bot_id === "b")).toEqual([]);
    expectConsistent();
    const list = await srv.listJointPromos(ctx("b"));
    expect(list[0]!.needsAnswer).toBe(false);
  });

  it("согласие и отмена одновременно, в любой комбинации: итог согласован, коды не «зависают» включёнными", async () => {
    const runs: Array<(id: string) => Array<Promise<unknown>>> = [
      (id) => [
        srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15)),
        srv.declineJointPromo(ctx("c"), id),
      ],
      (id) => [
        srv.declineJointPromo(ctx("c"), id),
        srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15)),
      ],
      (id) => [
        srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15)),
        srv.declineJointPromo(ctx("a"), id),
      ],
      (id) => [
        srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15)),
        srv.acceptJointPromo(ctx("c"), id, terms("FLOWERS20", 20)),
        srv.declineJointPromo(ctx("a"), id),
      ],
      (id) => [
        srv.declineJointPromo(ctx("a"), id),
        srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15)),
        srv.acceptJointPromo(ctx("c"), id, terms("FLOWERS20", 20)),
      ],
    ];
    for (const run of runs) {
      for (const t of ["joint_promos", "joint_promo_members", "promo_codes"]) db.tables[t] = [];
      const { id } = await propose();
      await Promise.allSettled(run(id));
      expectConsistent();
      // Отменённая акция не оживает от позднего согласия.
      if (status() === "cancelled")
        await expect(srv.acceptJointPromo(ctx("b"), id, terms("BORYA17", 15))).rejects.toThrow();
      expectConsistent();
    }
  });

  it("повторная отмена и отмена уже идущей акции безвредны", async () => {
    const { id } = await propose(["b"]);
    await srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15));
    expect(status()).toBe("active");
    await Promise.all([srv.declineJointPromo(ctx("a"), id), srv.declineJointPromo(ctx("b"), id)]);
    expect(status()).toBe("cancelled");
    expectConsistent();
    await srv.declineJointPromo(ctx("a"), id);
    expectConsistent();
  });
});

describe("кому можно предложить", () => {
  it("магазин вышел из сообщества после приглашения: согласиться не может, акция не включается", async () => {
    const { id } = await propose(["b"]);
    tenants[1] = { id: "b", name: "Б", modules: { coupons: true }, settings: { served_by: "v2" } };
    await expect(srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15))).rejects.toThrow(
      "Сначала включите",
    );
    expect(status()).toBe("proposed");
    expectConsistent();
  });

  it("магазин прежней платформы в каталог сообщества не попадает и приглашён быть не может", async () => {
    tenants[1] = {
      ...author("b", "Боря"),
      settings: { slug: "b", community: { enabled: true, name: "Боря" } },
    };
    await expect(propose(["b"])).rejects.toThrow("предложить нельзя");
    expect(db.tables.joint_promos).toHaveLength(0);
  });
});
