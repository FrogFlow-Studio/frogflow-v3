import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { pipelineBoard } from "./board";
import { listLeads, updateLead } from "./leads";
import { handoffLeadId, leadFromHandoff } from "./sources";

const BOT = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-09-27T05:00:00Z");
const later = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function setup(crm = true) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.orders = [];
  const ctx = {
    tenant: { id: BOT, modules: { crm_pipeline: crm } },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const customer = {
  userKey: "tg_555",
  platform: "telegram",
  telegramId: 555,
  username: "anna_k",
  firstName: "Анна",
  lastName: null,
  contactPhone: null,
} as unknown as Customer;

const handoff = {
  kind: "lead" as const,
  reason: "хочет торт",
  customerContact: "+77001112233",
  summary: "Торт на 3 кг к субботе",
};

describe("заявка из передачи ИИ-консультанта", () => {
  it("передача менеджеру заводит заявку «Новая» с контактом и сутью", async () => {
    const { ctx } = setup();
    await leadFromHandoff(ctx, customer, handoff, NOW);
    const [lead] = await listLeads(ctx);
    expect(lead).toMatchObject({
      id: handoffLeadId(customer.userKey),
      stage: "new",
      source: "handoff",
      name: "Анна",
      contact: "+77001112233",
      user_key: "tg_555",
    });
    expect(lead!.note).toContain("Торт на 3 кг к субботе");
  });

  it("без модуля воронки ничего не пишет", async () => {
    const { db, ctx } = setup(false);
    await leadFromHandoff(ctx, customer, handoff, NOW);
    expect(db.tables.app_settings).toEqual([]);
  });

  it("повторная передача того же покупателя не плодит карточки и не сбивает этап", async () => {
    const { ctx } = setup();
    await leadFromHandoff(ctx, customer, handoff, NOW);
    await updateLead(ctx, handoffLeadId(customer.userKey), { stage: "in_progress" }, later(1));
    await leadFromHandoff(
      ctx,
      customer,
      { ...handoff, summary: "Ещё вопрос про доставку" },
      later(2),
    );
    const leads = await listLeads(ctx);
    expect(leads).toHaveLength(1);
    expect(leads[0]!.stage).toBe("in_progress");
    expect(leads[0]!.note).toContain("Ещё вопрос про доставку");
  });

  it("после закрытой заявки новая передача открывает её заново", async () => {
    const { ctx } = setup();
    await leadFromHandoff(ctx, customer, handoff, NOW);
    await updateLead(ctx, handoffLeadId(customer.userKey), { stage: "lost" }, later(1));
    await leadFromHandoff(ctx, customer, handoff, later(48));
    const [lead] = await listLeads(ctx);
    expect(lead).toMatchObject({
      stage: "new",
      closed_at: null,
      created_at: later(48).toISOString(),
    });
  });

  it("без имени берёт @username, без контакта — телефон покупателя", async () => {
    const { ctx } = setup();
    await leadFromHandoff(
      ctx,
      { ...customer, firstName: null, contactPhone: "+77000000001" } as Customer,
      { kind: "handoff", reason: "жалоба", summary: "Не пришёл файл" },
      NOW,
    );
    const [lead] = await listLeads(ctx);
    expect(lead).toMatchObject({ name: "@anna_k", contact: "+77000000001" });
  });

  it("ошибка базы не роняет ответ покупателю", async () => {
    const ctx = {
      tenant: { id: BOT, modules: { crm_pipeline: true } },
      db: {
        from() {
          throw new Error("нет связи");
        },
      },
    } as unknown as TenantContext;
    await expect(leadFromHandoff(ctx, customer, handoff, NOW)).resolves.toBeUndefined();
  });
});

describe("заявка сливается с заказом", () => {
  it("когда покупатель заявки оформил заказ позже неё, на доске остаётся только заказ", async () => {
    const { db, ctx } = setup();
    await leadFromHandoff(ctx, customer, handoff, NOW);
    db.tables.orders!.push({
      id: 9,
      bot_id: BOT,
      order_no: 9,
      display_no: 9,
      display_name: "Анна",
      contact: null,
      total: 5000,
      currency: "KZT",
      status: "awaiting_payment",
      platform: "telegram",
      user_key: "tg_555",
      created_at: later(1).toISOString(),
    });
    const board = await pipelineBoard(ctx, later(2));
    const cards = board.columns.flatMap((c) => c.cards);
    expect(cards.map((c) => `${c.kind}:${c.id}`)).toEqual(["order:9"]);
  });

  it("старый заказ того же покупателя (до заявки) заявку не скрывает", async () => {
    const { db, ctx } = setup();
    db.tables.orders!.push({
      id: 3,
      bot_id: BOT,
      order_no: 3,
      display_no: 3,
      display_name: "Анна",
      contact: null,
      total: 5000,
      currency: "KZT",
      status: "delivered",
      platform: "telegram",
      user_key: "tg_555",
      created_at: new Date(NOW.getTime() - 200 * 86_400_000).toISOString(),
    });
    await leadFromHandoff(ctx, customer, handoff, NOW);
    const board = await pipelineBoard(ctx, later(2));
    const cards = board.columns.flatMap((c) => c.cards);
    expect(cards.map((c) => c.kind)).toEqual(["lead"]);
  });
});
