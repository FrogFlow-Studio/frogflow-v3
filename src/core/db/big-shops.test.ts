import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { runFunnel, FUNNEL_BATCH } from "@/core/funnel/funnel";
import { runWinback, WINBACK_BATCH } from "@/core/winback/winback";
import { quizResult } from "@/core/quiz/quiz";
import { notifyWaitlist } from "@/core/waitlist/waitlist";
import { allActiveProducts } from "@/core/catalog/active";
import { listLeads } from "@/core/pipeline/leads";
import { leadKey } from "@/core/pipeline/stages";

/**
 * Крупный магазин: строк больше, чем PostgREST отдаёт за раз (1000).
 * Тестовая база с тем же потолком ответа; прежний код с limit(1000) или
 * limit(5000) на этих данных молча терял хвост.
 */
const BOT = "00000000-0000-0000-0000-000000000001";
// Полдень в Алматы — крон шлёт только днём.
const NOW = new Date("2026-09-27T07:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function setup(modules: Record<string, boolean>) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.app_settings = [];
  db.tables.bot_users = [];
  db.tables.orders = [];
  db.tables.products = [];
  const ctx = {
    tenant: { id: BOT, modules },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const user = (tg: number, created: string, state: Record<string, unknown> = {}) => ({
  bot_id: BOT,
  user_key: `tg_${String(tg).padStart(6, "0")}`,
  telegram_id: tg,
  platform: "telegram",
  first_name: "Покупатель",
  created_at: created,
  state,
});

describe("большой магазин: ничего не теряется за первой тысячей", () => {
  it("автоворонка доходит до покупателей после первой тысячи", async () => {
    const { db, ctx } = setup({ funnel: true });
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: "funnel",
      value: JSON.stringify({
        enabled: true,
        stopOnOrder: true,
        steps: [{ afterHours: 1, text: "Привет, {name}", catalogButton: false }],
      }),
    });
    // 1200 старших уже вышли из серии, 300 младших ждут первого шага.
    for (let i = 0; i < 1500; i++)
      db.tables.bot_users!.push(
        user(i + 1, ago(10 - i / 1000), i < 1200 ? { funnel: { stopped: true } } : {}),
      );
    // Один из ждущих уже заказал — ему серия прекращается, а не шлётся.
    db.tables.orders!.push({ id: 1, bot_id: BOT, telegram_id: 1201, status: "paid" });
    const sent: number[] = [];
    const r = await runFunnel(
      ctx,
      async (c) => {
        sent.push(c.telegramId);
        return true;
      },
      NOW,
    );
    expect(r.sent).toBe(FUNNEL_BATCH);
    expect(sent).not.toContain(1201);
    expect(sent.every((tg) => tg > 1200)).toBe(true);
    const stopped = db.tables.bot_users!.find((u) => u.telegram_id === 1201)!;
    expect((stopped.state as { funnel?: { stopped?: boolean } }).funnel?.stopped).toBe(true);
  });

  it("возврат клиентов видит заказы после первых 5000", async () => {
    const { db, ctx } = setup({ winback: true });
    db.tables.app_settings!.push({
      bot_id: BOT,
      key: "winback",
      value: JSON.stringify({ enabled: true, days1: 30 }),
    });
    // 5000 свежих покупателей уже получили напоминание по своему заказу,
    // 1000 давних — ещё нет. Прежний limit(5000) по новизне их не видел.
    for (let i = 0; i < 6000; i++) {
      const tg = i + 1;
      const fresh = i >= 1000;
      db.tables.orders!.push({
        id: tg,
        bot_id: BOT,
        telegram_id: tg,
        status: "delivered",
        created_at: ago(fresh ? 40 : 100),
      });
      db.tables.bot_users!.push(
        user(tg, ago(200), fresh ? { winback: { order_id: tg, step: 1, at: ago(5) } } : {}),
      );
    }
    const sent: number[] = [];
    const r = await runWinback(
      ctx,
      async (c) => {
        sent.push(c.telegramId);
        return true;
      },
      NOW,
    );
    expect(r.sent).toBe(WINBACK_BATCH);
    expect(sent.every((tg) => tg <= 1000)).toBe(true);
  });

  it("квиз подбирает среди всех товаров, а не первой тысячи", async () => {
    const { db, ctx } = setup({});
    for (let i = 0; i < 1500; i++)
      db.tables.products!.push({
        id: `p${String(i).padStart(5, "0")}`,
        bot_id: BOT,
        is_active: true,
        name: i === 1400 ? "Прописи для левши" : `Товар ${i}`,
        keywords: null,
        description: null,
        stock_quantity: null,
      });
    const found = await quizResult(ctx, ["левши"]);
    expect(found.map((p) => p.id)).toEqual(["p01400"]);
    expect(await allActiveProducts(ctx, "id")).toHaveLength(1500);
  });

  it("лист ожидания оповещает всех ждущих", async () => {
    const { db, ctx } = setup({});
    for (let i = 0; i < 1500; i++)
      db.tables.bot_users!.push(user(i + 1, ago(30), { waitlist: ["prod-1"] }));
    const r = await notifyWaitlist(ctx, "prod-1", async () => true);
    expect(r).toEqual({ notified: 1500, failed: 0, left: 0 });
    expect(
      db.tables.bot_users!.filter((u) =>
        ((u.state as { waitlist?: string[] }).waitlist ?? []).includes("prod-1"),
      ),
    ).toHaveLength(0);
  });

  it("воронка сделок показывает все заявки, а не первую тысячу", async () => {
    const { db, ctx } = setup({ crm_pipeline: true });
    for (let i = 0; i < 1300; i++) {
      const id = `lead-${String(i).padStart(5, "0")}`;
      db.tables.app_settings!.push({
        bot_id: BOT,
        key: leadKey(id),
        value: JSON.stringify({ id, stage: "new", name: `Клиент ${i}`, created_at: ago(1) }),
      });
    }
    expect(await listLeads(ctx)).toHaveLength(1300);
  });
});
