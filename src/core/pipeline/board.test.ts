import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pipelineBoard, CLOSED_WINDOW_DAYS } from "./board";
import { createLead, updateLead } from "./leads";

const BOT = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-09-27T05:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function order(id: number, status: string, created: string, over: Record<string, unknown> = {}) {
  return {
    id,
    bot_id: BOT,
    order_no: id,
    display_no: id,
    display_name: `Покупатель ${id}`,
    contact: null,
    total: 1000 * id,
    currency: "KZT",
    status,
    platform: "telegram",
    user_key: `tg_${id}`,
    created_at: created,
    ...over,
  };
}

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.orders = [
    order(1, "awaiting_payment", daysAgo(1)),
    order(2, "awaiting_confirmation", daysAgo(2)),
    order(3, "in_production", daysAgo(3)),
    order(4, "delivered", daysAgo(4)),
    order(5, "delivered", daysAgo(CLOSED_WINDOW_DAYS + 5)),
    order(6, "rejected", daysAgo(1)),
    // Открытый старый заказ остаётся на доске, сколько бы ему ни было.
    order(7, "awaiting_payment", daysAgo(200)),
  ];
  const ctx = {
    tenant: { id: BOT, modules: { crm_pipeline: true } },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const ids = (board: Awaited<ReturnType<typeof pipelineBoard>>, stage: string) =>
  board.columns.find((c) => c.stage === stage)!.cards.map((c) => `${c.kind}:${c.id}`);

describe("доска воронки", () => {
  it("заказы разложены по этапам статуса, старые закрытые не показываются", async () => {
    const { ctx } = setup();
    const board = await pipelineBoard(ctx, NOW);
    expect(board.columns.map((c) => c.stage)).toEqual([
      "new",
      "in_progress",
      "awaiting_payment",
      "paid",
      "won",
      "lost",
    ]);
    expect(ids(board, "awaiting_payment")).toEqual(["order:1", "order:2", "order:7"]);
    expect(ids(board, "paid")).toEqual(["order:3"]);
    expect(ids(board, "won")).toEqual(["order:4"]);
    expect(ids(board, "lost")).toEqual(["order:6"]);
  });

  it("карточка заказа: номер, покупатель, сумма", async () => {
    const { ctx } = setup();
    const card = (await pipelineBoard(ctx, NOW)).columns
      .flatMap((c) => c.cards)
      .find((c) => c.kind === "order" && c.id === "3")!;
    expect(card).toMatchObject({
      title: "Покупатель 3",
      orderNo: 3,
      amount: 3000,
      currency: "KZT",
      platform: "telegram",
    });
  });

  it("заявки стоят на своих этапах; закрытые старше окна не показываются", async () => {
    const { ctx } = setup();
    const a = await createLead(ctx, { name: "Анна", contact: "1" }, NOW);
    const b = await createLead(ctx, { name: "Борис", contact: "2" }, NOW);
    const c = await createLead(ctx, { name: "Вера", contact: "3" }, NOW);
    await updateLead(ctx, b.id, { stage: "in_progress" }, NOW);
    await updateLead(ctx, c.id, { stage: "lost" }, new Date(daysAgo(CLOSED_WINDOW_DAYS + 1)));
    const board = await pipelineBoard(ctx, NOW);
    expect(ids(board, "new")).toEqual([`lead:${a.id}`]);
    expect(ids(board, "in_progress")).toEqual([`lead:${b.id}`]);
    expect(ids(board, "lost")).toEqual(["order:6"]);
  });

  it("открытых заказов больше потолка — на доске самые новые", async () => {
    const { db, ctx } = setup();
    db.tables.orders = Array.from({ length: 510 }, (_, i) =>
      order(
        1000 + i,
        "awaiting_payment",
        new Date(NOW.getTime() - (510 - i) * 60_000).toISOString(),
      ),
    );
    const cards = ids(await pipelineBoard(ctx, NOW), "awaiting_payment");
    expect(cards).toHaveLength(500);
    expect(cards[0]).toBe("order:1509");
    expect(cards).not.toContain("order:1000");
  });

  it("без модуля доски нет", async () => {
    const { ctx } = setup();
    (ctx.tenant.modules as Record<string, boolean>).crm_pipeline = false;
    await expect(pipelineBoard(ctx, NOW)).rejects.toThrow(/Воронка/);
  });
});
