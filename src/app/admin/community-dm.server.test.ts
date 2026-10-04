import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";

const db = fakeDb();
const sent: Array<{ botId: string; html: string; kind?: string }> = [];
let failSend = false;
const tenants = [
  {
    id: "a",
    name: "A",
    settings: { served_by: "v2", community: { enabled: true, name: "Аня <i>" } },
  },
  { id: "b", name: "B", settings: { served_by: "v2", community: { enabled: true, name: "Боря" } } },
];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => tenants,
  patchTenantSettings: async () => {},
  tenantContext: (t: { id: string }) => ({ tenant: t }),
}));
vi.mock("@/channels/telegram/notify", () => ({
  notifyAdminsHtml: async (c: { tenant: { id: string } }, html: string, o: { kind?: string }) => {
    if (failSend) throw new Error("Telegram 500");
    sent.push({ botId: c.tenant.id, html, kind: o.kind });
    return 1;
  },
}));
vi.mock("@/app/admin/locale.server", async () => {
  const { adminT } = await import("@/app/i18n/admin");
  return { adminTFor: async () => adminT("ru") };
});

const { sendCommunityDm } = await import("./community-dm.server");
const ctx = (id: string) =>
  ({ tenant: tenants.find((t) => t.id === id) }) as unknown as TenantContext;

beforeEach(() => {
  db.tables.community_dm = [];
  sent.length = 0;
  failSend = false;
});

describe("личное сообщение: уведомление автору", () => {
  it("на каждое сообщение — одно уведомление адресату, имя отправителя экранировано", async () => {
    await sendCommunityDm(ctx("a"), "b", "привет");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ botId: "b", kind: "system" });
    expect(sent[0]!.html).toContain("Аня &lt;i&gt;");
    expect(db.tables.community_dm![0]!.notified_at).toBeTruthy();
    await sendCommunityDm(ctx("a"), "b", "ещё одно");
    expect(sent).toHaveLength(2);
  });

  it("сбой Telegram не теряет сообщение и не повторяет отправку", async () => {
    failSend = true;
    const r = await sendCommunityDm(ctx("a"), "b", "привет");
    expect(r.id).toBeTruthy();
    expect(db.tables.community_dm).toHaveLength(1);
    // Отметка уже стоит: повторное занятие права не пройдёт, дубль уведомления невозможен.
    const { claimDmNotice } = await import("@/core/community/dm.server");
    expect(await claimDmNotice(r.id)).toBe(false);
  });
});
