import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";

const db = fakeDb({
  unique: { promo_codes: [["bot_id", "code"]], joint_promo_members: [["promo_id", "bot_id"]] },
});
const sent: Array<{ botId: string; html: string }> = [];
let failFor: string | null = null;
const mk = (id: string, name: string) => ({
  id,
  name,
  modules: { coupons: true },
  settings: { served_by: "v2", community: { enabled: true, name } },
});
const tenants = [mk("a", "Аня <b>"), mk("b", "Боря"), mk("c", "Цветы")];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => tenants,
  tenantContext: (t: { id: string }) => ({ tenant: t }),
}));
vi.mock("@/channels/telegram/notify", () => ({
  notifyAdminsHtml: async (c: { tenant: { id: string } }, html: string) => {
    if (c.tenant.id === failFor) throw new Error("Telegram 500");
    sent.push({ botId: c.tenant.id, html });
    return 1;
  },
}));
vi.mock("@/app/admin/locale.server", async () => {
  const { adminT } = await import("@/app/i18n/admin");
  return { adminTFor: async () => adminT("ru") };
});

const { proposeJointPromo } = await import("./community-promos.server");
const FUTURE = new Date(Date.now() + 5 * 86_400_000).toISOString();
const ctx = () => ({ tenant: tenants[0], db }) as unknown as TenantContext;

beforeEach(() => {
  for (const t of ["joint_promos", "joint_promo_members", "promo_codes"]) db.tables[t] = [];
  sent.length = 0;
  failFor = null;
});

describe("предложение акции: уведомления участникам", () => {
  it("каждому приглашённому — одно уведомление, название и имя экранированы", async () => {
    await proposeJointPromo(ctx(), {
      title: "Дуэт <i>",
      endsAt: FUTURE,
      partnerIds: ["b", "c"],
      terms: { code: "ANYA10", percent: 10, conditions: "" },
    });
    expect(sent.map((s) => s.botId)).toEqual(["b", "c"]);
    expect(sent[0]!.html).toContain("Аня &lt;b&gt;");
    expect(sent[0]!.html).toContain("Дуэт &lt;i&gt;");
    expect(db.tables.joint_promo_members!.filter((m) => m.notified_at)).toHaveLength(2);
  });

  it("сбой Telegram у одного не срывает остальных и не теряет акцию", async () => {
    failFor = "b";
    const r = await proposeJointPromo(ctx(), {
      title: "Дуэт",
      endsAt: FUTURE,
      partnerIds: ["b", "c"],
      terms: { code: "ANYA10", percent: 10, conditions: "" },
    });
    expect(r.id).toBeTruthy();
    expect(sent.map((s) => s.botId)).toEqual(["c"]);
    expect(db.tables.joint_promos).toHaveLength(1);
  });
});
