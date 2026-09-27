import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { createLead, listLeads, updateLead } from "./leads";
import { leadKey } from "./stages";

const BOT = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-09-27T05:00:00Z");

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    { bot_id: BOT, key: "crm_webhook", value: "{}" },
    { bot_id: BOT, key: "crmXlead:x", value: "{}" },
  ];
  const ctx = {
    tenant: { id: BOT, modules: { crm_pipeline: true } },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("заявки воронки", () => {
  it("продавец заводит заявку — она на этапе «Новая»", async () => {
    const { db, ctx } = setup();
    const lead = await createLead(ctx, { name: "Анна", contact: "+77000000000" }, NOW);
    expect(lead).toMatchObject({ stage: "new", source: "manual", name: "Анна" });
    expect(db.tables.app_settings!.some((r) => r.key === leadKey(lead.id))).toBe(true);
    expect(await listLeads(ctx)).toEqual([lead]);
  });

  it("список берёт только ключи crm:lead:, битые пропускает", async () => {
    const { db, ctx } = setup();
    const lead = await createLead(ctx, { name: "Анна", contact: "1" }, NOW);
    db.tables.app_settings!.push({ bot_id: BOT, key: "crm:lead:broken", value: "abc" });
    expect((await listLeads(ctx)).map((l) => l.id)).toEqual([lead.id]);
  });

  it("перенос по этапам и заметка; закрытие ставит дату", async () => {
    const { ctx } = setup();
    const lead = await createLead(ctx, { name: "Анна", contact: "1" }, NOW);
    const later = new Date("2026-09-28T10:00:00Z");
    const moved = await updateLead(
      ctx,
      lead.id,
      { stage: "in_progress", note: "позвонить" },
      later,
    );
    expect(moved).toMatchObject({ stage: "in_progress", note: "позвонить", closed_at: null });
    const lost = await updateLead(ctx, lead.id, { stage: "lost" }, later);
    expect(lost).toMatchObject({ stage: "lost", closed_at: later.toISOString() });
    const back = await updateLead(ctx, lead.id, { stage: "new" }, later);
    expect(back!.closed_at).toBeNull();
  });

  it("неизвестная заявка — null, ничего не создаётся", async () => {
    const { db, ctx } = setup();
    const before = db.tables.app_settings!.length;
    expect(
      await updateLead(ctx, "3f0c2a8e-1b2c-4d5e-8f90-123456789abc", { stage: "lost" }),
    ).toBeNull();
    expect(db.tables.app_settings!).toHaveLength(before);
  });

  it("два одновременных изменения не теряют друг друга", async () => {
    const { ctx } = setup();
    const lead = await createLead(ctx, { name: "Анна", contact: "1" }, NOW);
    await Promise.all([
      updateLead(ctx, lead.id, { note: "заметка" }),
      updateLead(ctx, lead.id, { owner: "manager1" }),
    ]);
    const [saved] = await listLeads(ctx);
    expect(saved).toMatchObject({ note: "заметка", owner: "manager1" });
  });
});
