import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

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

const author = (id: string, name: string, extra: Record<string, unknown> = {}, coupons = true) => ({
  id,
  name: `Магазин ${name}`,
  modules: { coupons },
  settings: { served_by: "v2", slug: `shop-${id}`, community: { enabled: true, name }, ...extra },
});
const ctx = (id: string) =>
  ({ tenant: tenants.find((t) => t.id === id), db }) as unknown as TenantContext;
const FUTURE = new Date(Date.now() + 10 * 86_400_000).toISOString();
const terms = (code: string, percent: number, conditions = "") => ({ code, percent, conditions });

beforeEach(() => {
  for (const t of ["joint_promos", "joint_promo_members", "promo_codes", "orders"])
    db.tables[t] = [];
  tenants = [author("a", "Аня"), author("b", "Боря"), author("c", "Цветы")];
});

async function propose(partners = ["b", "c"]) {
  return srv.createJointPromo(ctx("a"), {
    title: "Весенний дуэт",
    endsAt: FUTURE,
    partnerIds: partners,
    terms: terms("ANYA10", 10, "от 5000"),
  });
}
const codeOf = (bot: string) => db.tables.promo_codes!.filter((r) => r.bot_id === bot);

describe("совместные акции: предложение", () => {
  it("создаёт акцию, свой код автора неактивен, у остальных кодов ещё нет", async () => {
    const { id, invited } = await propose();
    expect(invited).toEqual(["b", "c"]);
    expect(db.tables.joint_promos![0]).toMatchObject({ id, status: "proposed", created_by: "a" });
    expect(db.tables.joint_promo_members!.map((m) => [m.bot_id, m.status])).toEqual([
      ["a", "accepted"],
      ["b", "invited"],
      ["c", "invited"],
    ]);
    expect(codeOf("a")).toHaveLength(1);
    expect(codeOf("a")[0]).toMatchObject({
      code: "ANYA10",
      discount_type: "percent",
      discount_value: 10,
      is_active: false,
      bot_id: "a",
    });
    expect(codeOf("b")).toEqual([]);
    expect(codeOf("c")).toEqual([]);
  });

  it("2–3 магазина: без партнёров и с тремя нельзя; партнёр без согласия или без промокодов — тоже", async () => {
    await expect(propose([])).rejects.toThrow("2–3 магазина");
    tenants.push(author("d", "Д"), author("e", "Е"));
    await expect(propose(["b", "c", "d"])).rejects.toThrow("2–3 магазина");
    tenants[1] = { id: "b", name: "Б", modules: { coupons: true }, settings: { served_by: "v2" } };
    await expect(propose(["b"])).rejects.toThrow("предложить нельзя");
    tenants[1] = author("b", "Боря", {}, false);
    await expect(propose(["b"])).rejects.toThrow("предложить нельзя");
    expect(db.tables.joint_promos).toHaveLength(0);
  });

  it("несогласный автор и магазин без модуля промокодов не предлагают", async () => {
    tenants[0] = { id: "a", name: "A", modules: { coupons: true }, settings: { served_by: "v2" } };
    await expect(propose()).rejects.toThrow("Сначала включите");
    tenants[0] = author("a", "Аня", {}, false);
    await expect(propose()).rejects.toThrow("модуль промокодов");
  });

  it("занятый код отменяет предложение целиком: ни акции, ни участников", async () => {
    db.tables.promo_codes!.push({ id: "old", bot_id: "a", code: "ANYA10", is_active: true });
    await expect(propose()).rejects.toThrow("Такой код уже есть");
    expect(db.tables.joint_promos).toHaveLength(0);
    expect(db.tables.joint_promo_members).toHaveLength(0);
  });

  it("кривые данные отклоняются: код, скидка, дата, название", async () => {
    const base = {
      title: "Весенний дуэт",
      endsAt: FUTURE,
      partnerIds: ["b"],
      terms: terms("ANYA10", 10),
    };
    await expect(srv.createJointPromo(ctx("a"), { ...base, title: "x" })).rejects.toThrow(
      "от 3 символов",
    );
    await expect(
      srv.createJointPromo(ctx("a"), { ...base, endsAt: "2020-01-01T00:00:00Z" }),
    ).rejects.toThrow("в будущем");
    await expect(
      srv.createJointPromo(ctx("a"), { ...base, terms: terms("x", 10) }),
    ).rejects.toThrow("3–30");
    await expect(
      srv.createJointPromo(ctx("a"), { ...base, terms: terms("ANYA10", 95) }),
    ).rejects.toThrow("от 1 до 90");
    expect(db.tables.joint_promos).toHaveLength(0);
  });
});

describe("совместные акции: согласие и включение", () => {
  it("не активна, пока согласились не все; когда все — включаются коды каждого, и только свои", async () => {
    const { id } = await propose();
    expect(
      (await srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15, "по пятницам"))).active,
    ).toBe(false);
    expect(db.tables.joint_promos![0]!.status).toBe("proposed");
    expect([...codeOf("a"), ...codeOf("b")].every((c) => c.is_active === false)).toBe(true);
    expect((await srv.acceptJointPromo(ctx("c"), id, terms("FLOWERS20", 20))).active).toBe(true);
    expect(db.tables.joint_promos![0]).toMatchObject({ status: "active" });
    // У каждого магазина ровно один свой код со своей скидкой; чужих строк нет.
    expect(db.tables.promo_codes).toHaveLength(3);
    expect(codeOf("a")[0]).toMatchObject({ code: "ANYA10", discount_value: 10, is_active: true });
    expect(codeOf("b")[0]).toMatchObject({ code: "BORYA15", discount_value: 15, is_active: true });
    expect(codeOf("c")[0]).toMatchObject({
      code: "FLOWERS20",
      discount_value: 20,
      is_active: true,
    });
    // Деньги и заказы платформа не трогает.
    expect(db.tables.orders).toEqual([]);
  });

  it("условия одного магазина не меняют другого", async () => {
    const { id } = await propose(["b"]);
    const before = JSON.stringify(codeOf("a"));
    await srv.acceptJointPromo(ctx("b"), id, terms("BORYA50", 50, "только мне"));
    const members = db.tables.joint_promo_members!;
    expect(members.find((m) => m.bot_id === "a")).toMatchObject({
      code: "ANYA10",
      discount_percent: 10,
      conditions: "от 5000",
    });
    expect(members.find((m) => m.bot_id === "b")).toMatchObject({
      code: "BORYA50",
      discount_percent: 50,
    });
    expect(JSON.stringify(codeOf("a").map((c) => ({ ...c, is_active: false })))).toBe(
      JSON.stringify(JSON.parse(before).map((c: object) => ({ ...c, is_active: false }))),
    );
  });

  it("двойной клик «Согласиться»: один код, второй вызов получает отказ", async () => {
    const { id } = await propose(["b"]);
    const r = await Promise.allSettled([
      srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15)),
      srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15)),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(codeOf("b")).toHaveLength(1);
    expect(db.tables.joint_promos![0]!.status).toBe("active");
  });

  it("последние двое соглашаются одновременно: акция включается один раз, коды у всех включены", async () => {
    const { id } = await propose();
    const res = await Promise.all([
      srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15)),
      srv.acceptJointPromo(ctx("c"), id, terms("FLOWERS20", 20)),
    ]);
    expect(db.tables.joint_promos![0]!.status).toBe("active");
    expect(db.tables.promo_codes!.every((c) => c.is_active === true)).toBe(true);
    expect(db.tables.promo_codes).toHaveLength(3);
    // Включает коды ровно один вызов: статус занял только он.
    expect(res.filter((r) => r.active)).toHaveLength(1);
  });

  it("отмена между занятием статуса и включением кодов: итог «отменена и коды выключены»", async () => {
    const { id } = await propose(["b"]);
    const real = db.from.bind(db);
    let fired = false;
    const spy = vi.spyOn(db, "from").mockImplementation(((table: string) => {
      const q = real(table) as {
        update: (p: Record<string, unknown>) => { eq: (c: string, v: unknown) => unknown };
      };
      if (table !== "promo_codes") return q;
      const update = q.update.bind(q);
      // Включение кодов (is_active: true) идёт из settle: в этот момент партнёр отменяет акцию.
      q.update = (patch: Record<string, unknown>) => {
        if (patch.is_active === true && !fired) {
          fired = true;
          return {
            eq: () => ({
              eq: async () => {
                spy.mockRestore();
                await srv.declineJointPromo(ctx("b"), id);
                return update(patch).eq("id", db.tables.promo_codes![0]!.id);
              },
            }),
          };
        }
        return update(patch);
      };
      return q;
    }) as never);
    await srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15));
    spy.mockRestore();
    expect(fired).toBe(true);
    expect(db.tables.joint_promos![0]!.status).toBe("cancelled");
    expect(db.tables.promo_codes!.length).toBeGreaterThan(0);
    expect(db.tables.promo_codes!.every((c) => c.is_active === false)).toBe(true);
  });

  it("занятый код участника: согласие откатывается, можно ответить другим кодом", async () => {
    const { id } = await propose(["b"]);
    db.tables.promo_codes!.push({ id: "old", bot_id: "b", code: "BORYA15", is_active: true });
    await expect(srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15))).rejects.toThrow(
      "Такой код уже есть",
    );
    expect(db.tables.joint_promo_members!.find((m) => m.bot_id === "b")).toMatchObject({
      status: "invited",
      code: null,
    });
    await srv.acceptJointPromo(ctx("b"), id, terms("BORYA16", 15));
    expect(db.tables.joint_promos![0]!.status).toBe("active");
  });

  it("отказ отменяет акцию целиком и выключает уже созданные коды", async () => {
    const { id } = await propose();
    await srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15));
    await srv.declineJointPromo(ctx("c"), id);
    expect(db.tables.joint_promos![0]!.status).toBe("cancelled");
    expect(db.tables.joint_promo_members!.find((m) => m.bot_id === "c")!.status).toBe("declined");
    expect(db.tables.promo_codes!.every((c) => c.is_active === false)).toBe(true);
    await expect(srv.acceptJointPromo(ctx("c"), id, terms("FLOWERS20", 20))).rejects.toThrow(
      "уже закрыта",
    );
  });

  it("автор отменяет идущую акцию: коды всех выключены", async () => {
    const { id } = await propose(["b"]);
    await srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15));
    expect(db.tables.promo_codes!.every((c) => c.is_active === true)).toBe(true);
    await srv.declineJointPromo(ctx("a"), id);
    expect(db.tables.promo_codes!.every((c) => c.is_active === false)).toBe(true);
  });

  it("чужая акция недоступна", async () => {
    const { id } = await propose(["b"]);
    await expect(srv.acceptJointPromo(ctx("c"), id, terms("FLOWERS20", 20))).rejects.toThrow(
      "Такой акции нет",
    );
    await expect(srv.declineJointPromo(ctx("c"), id)).rejects.toThrow("Такой акции нет");
  });
});

describe("совместные акции: список и витрина", () => {
  it("условия чужого магазина видны, только когда он согласился", async () => {
    const { id } = await propose(["b"]);
    const [forA] = await srv.listJointPromos(ctx("a"));
    expect(forA!.members.find((m) => !m.mine)).toMatchObject({
      status: "invited",
      code: null,
      percent: null,
    });
    const [forB] = await srv.listJointPromos(ctx("b"));
    expect(forB).toMatchObject({ needsAnswer: true, createdByMe: false });
    expect(forB!.members.find((m) => !m.mine)).toMatchObject({ code: "ANYA10", percent: 10 });
    await srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15));
    const [after] = await srv.listJointPromos(ctx("a"));
    expect(after).toMatchObject({ status: "active" });
    expect(after!.members.find((m) => !m.mine)).toMatchObject({ code: "BORYA15", percent: 15 });
    expect(await srv.listJointPromos(ctx("c"))).toEqual([]);
  });

  it("витрина показывает акцию партнёров с обеих сторон, цифры — из настоящих промокодов", async () => {
    const { id } = await propose(["b"]);
    expect(await srv.partnerBanners(ctx("a"))).toEqual([]);
    await srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15, "по пятницам"));
    const [fromA] = await srv.partnerBanners(ctx("a"));
    expect(fromA).toMatchObject({
      title: "Весенний дуэт",
      mine: { code: "ANYA10", percent: 10, conditions: "от 5000" },
      partners: [
        { name: "Боря", slug: "shop-b", code: "BORYA15", percent: 15, conditions: "по пятницам" },
      ],
    });
    const [fromB] = await srv.partnerBanners(ctx("b"));
    expect(fromB).toMatchObject({
      mine: { code: "BORYA15", percent: 15 },
      partners: [{ name: "Аня", slug: "shop-a", code: "ANYA10", percent: 10 }],
    });
    // Продавец поменял скидку в обычном промокоде — витрина показывает настоящую.
    codeOf("b")[0]!.discount_value = 25;
    expect((await srv.partnerBanners(ctx("a")))[0]!.partners[0]!.percent).toBe(25);
  });

  it("витрина молчит: код выключен, срок вышел, участник отозвал согласие, акция отменена", async () => {
    const { id } = await propose(["b"]);
    await srv.acceptJointPromo(ctx("b"), id, terms("BORYA15", 15));
    expect(await srv.partnerBanners(ctx("a"))).toHaveLength(1);
    codeOf("b")[0]!.is_active = false;
    expect(await srv.partnerBanners(ctx("a"))).toEqual([]);
    codeOf("b")[0]!.is_active = true;
    codeOf("b")[0]!.valid_until = new Date(Date.now() - 1000).toISOString();
    expect(await srv.partnerBanners(ctx("a"))).toEqual([]);
    codeOf("b")[0]!.valid_until = FUTURE;
    tenants[1] = author("b", "Боря", { community: { enabled: false, name: "Боря" } });
    expect(await srv.partnerBanners(ctx("a"))).toEqual([]);
    tenants[1] = author("b", "Боря");
    expect(await srv.partnerBanners(ctx("a"))).toHaveLength(1);
    await srv.declineJointPromo(ctx("a"), id);
    expect(await srv.partnerBanners(ctx("a"))).toEqual([]);
    // Несогласный магазин акцию вообще не показывает.
    expect(
      await srv.partnerBanners({ tenant: { settings: { served_by: "v2" }, id: "z" } } as never),
    ).toEqual([]);
  });

  it("одно уведомление на приглашение: занять право может один вызов", async () => {
    const { id } = await propose(["b"]);
    const r = await Promise.all([srv.claimInviteNotice(id, "b"), srv.claimInviteNotice(id, "b")]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await srv.claimInviteNotice(id, "b")).toBe(false);
  });
});
