import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { Tenant } from "@/core/tenant/types";

/**
 * Ежедневный обход подписок (sweepSubscriptions) на базе в памяти: кого
 * предупредить, кого приостановить, кого не трогать. Живой прогон на
 * демо-клиенте — tests/integration/subscriptions-sweep.test.ts.
 */
let db: FakeDb;
let tenants: Tenant[] = [];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  // Копии: у каждого прогона свой снимок справочника, как у двух кронов на проде.
  tenantDirectory: async () => tenants.map((t) => ({ ...t })),
  invalidateTenantDirectory: () => {},
}));

const { sweepSubscriptions } = await import("./billing.server");

const BOT = "00000000-0000-0000-0000-0000000000a1";
const NOW = new Date("2026-09-26T09:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function tenant(settings: Record<string, unknown> = {}, status = "active"): Tenant {
  return {
    id: BOT,
    name: "Демо",
    status,
    archived: false,
    plan: null,
    settings: { served_by: "v2", warn_days_before: 3, grace_days: 2, ...settings },
  } as unknown as Tenant;
}

let sent: string[] = [];
const notify = async (_id: string, text: string) => {
  sent.push(text);
  return { ok: true, detail: "fake" };
};
const invoicer = async () => null;
const sweep = (now = NOW) => sweepSubscriptions(now, notify, BOT, invoicer);
const bot = () => db.tables.bots![0]!;
const markers = () =>
  (db.tables.bot_events ?? []).map((e) => (e.payload as { sweep_marker?: string }).sweep_marker);

function setup(expires: string | null, settings: Record<string, unknown> = {}, status = "active") {
  tenants = [tenant(settings, status)];
  db.tables.bots = [{ id: BOT, status, subscription_expires_at: expires }];
  db.tables.bot_events = [];
}

beforeEach(() => {
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.zernio_logs = [];
  sent = [];
});

describe("обход подписок", () => {
  it("оплаченный бот не трогает", async () => {
    setup(day(30));
    const [r] = await sweep();
    expect(r).toMatchObject({ state: "ok", action: "skipped" });
    expect(sent).toEqual([]);
    expect(bot().status).toBe("active");
    expect(markers()).toEqual([]);
  });

  it("просрочка дольше отсрочки с политикой suspend — приостанавливает и уведомляет", async () => {
    setup(day(-5), { on_overdue: "suspend" });
    const [r] = await sweep();
    expect(r).toMatchObject({ state: "grace_over", action: "suspended" });
    expect(bot().status).toBe("suspended");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("приостановлен");
    expect(markers()).toEqual([`suspend:${day(-5)}`]);
  });

  it("та же просрочка с политикой warn — только предупреждает, не приостанавливает", async () => {
    setup(day(-5), { on_overdue: "warn" });
    const [r] = await sweep();
    expect(r).toMatchObject({ state: "grace_over", action: "warned" });
    expect(bot().status).toBe("active");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("просрочена на 5 дн.");
    expect(sent[0]).toContain("продолжит работать");
  });

  it("новый оплаченный период после предупреждения — предупреждает заново", async () => {
    setup(day(2));
    expect((await sweep())[0]!.action).toBe("warned");
    // Тот же период и тот же день — молчит.
    expect((await sweep())[0]!.action).toBe("skipped");
    // Оплатили месяц — срок сдвинулся; ближе к новому концу тот же день
    // (часы сдвинуты, как бывает при продлении) снова даёт предупреждение.
    const next = new Date(new Date(day(2)).getTime() + 30 * 86_400_000);
    bot().subscription_expires_at = next.toISOString();
    const later = new Date(next.getTime() - 2 * 86_400_000);
    expect((await sweep(later))[0]!.action).toBe("warned");
    expect(sent).toHaveLength(2);
    expect(new Set(markers()).size).toBe(2);
  });

  it("уже приостановленного бота повторно не трогает", async () => {
    setup(day(-10), { on_overdue: "suspend" }, "suspended");
    const [r] = await sweep();
    expect(r).toMatchObject({ action: "skipped" });
    expect(sent).toEqual([]);
    expect(markers()).toEqual([]);
  });

  it("без даты подписки — пропускает", async () => {
    setup(null, { on_overdue: "suspend" });
    const [r] = await sweep();
    expect(r).toMatchObject({ state: "no_data", action: "skipped" });
    expect(sent).toEqual([]);
    expect(bot().status).toBe("active");
  });

  it("приостановка — один раз на период, повторный проход её не дублирует", async () => {
    setup(day(-5), { on_overdue: "suspend" });
    await sweep();
    // Оператор вручную вернул бота, срок тот же — крон не приостанавливает снова.
    bot().status = "active";
    tenants = [tenant({ on_overdue: "suspend" })];
    const [r] = await sweep();
    expect(r).toMatchObject({ action: "skipped", detail: "уже сделано" });
    expect(bot().status).toBe("active");
  });

  it("без onlyBotId трогает только клиентов на v2: клиент v1 и архивный — нет", async () => {
    const V2 = "00000000-0000-0000-0000-0000000000b2";
    const V1 = "00000000-0000-0000-0000-0000000000b3";
    const OLD = "00000000-0000-0000-0000-0000000000b4";
    const V1_EXPLICIT = "00000000-0000-0000-0000-0000000000b5";
    const make = (id: string, servedBy: string | undefined, archived = false) =>
      ({
        ...tenant({ on_overdue: "suspend", served_by: servedBy }),
        id,
        archived,
      }) as Tenant;
    tenants = [make(V2, "v2"), make(V1, undefined), make(V1_EXPLICIT, "v1"), make(OLD, "v2", true)];
    db.tables.bots = [V2, V1, V1_EXPLICIT, OLD].map((id) => ({
      id,
      status: "active",
      subscription_expires_at: day(-5),
    }));
    db.tables.bot_events = [];
    const notified: string[] = [];
    const r = await sweepSubscriptions(
      NOW,
      async (id) => {
        notified.push(id);
        return { ok: true, detail: "fake" };
      },
      undefined,
      invoicer,
    );
    expect(r.map((e) => [e.bot_id, e.action])).toEqual([[V2, "suspended"]]);
    expect(notified).toEqual([V2]);
    const status = Object.fromEntries(db.tables.bots.map((b) => [b.id, b.status]));
    expect(status).toEqual({
      [V2]: "suspended",
      [V1]: "active",
      [V1_EXPLICIT]: "active",
      [OLD]: "active",
    });
    expect(db.tables.bot_events.map((e) => e.bot_id)).toEqual([V2]);
  });
});

/** Отправка и выставление счёта идут по сети: окно между проверкой и отметкой широкое. */
const network = () => new Promise<void>((r) => setTimeout(r, 15));
/** Прогрев ленивых импортов обхода, чтобы два прогона шли действительно рядом. */
const warm = async () => {
  const keep = bot().subscription_expires_at;
  bot().subscription_expires_at = day(30);
  await sweep();
  bot().subscription_expires_at = keep;
};
const slowNotify = async (_id: string, text: string) => {
  await network();
  sent.push(text);
  return { ok: true, detail: "fake" };
};

describe("обход подписок: два крона одновременно", () => {
  it("предупреждение — одно сообщение и одна отметка", async () => {
    setup(day(2));
    await warm();
    const r = await Promise.all([
      sweepSubscriptions(NOW, slowNotify, BOT, invoicer),
      sweepSubscriptions(NOW, slowNotify, BOT, invoicer),
    ]);
    expect(sent).toHaveLength(1);
    expect(r.flat().filter((x) => x.action === "warned")).toHaveLength(1);
    expect(markers().filter((m) => m?.startsWith("warn:"))).toHaveLength(1);
  });

  it("приостановка: действие уже занято соседним кроном — не приостанавливаем и не пишем второй раз", async () => {
    setup(day(-5), { on_overdue: "suspend" });
    // Соседний обход успел занять приостановку (его запись в журнале уже стоит).
    db.tables.zernio_logs!.push({
      id: "claim",
      bot_id: BOT,
      event_id: `sweep:${BOT}:suspend:${day(-5)}`,
      event_type: "sweep.claim",
      status: "processed",
    });
    const [r] = await sweepSubscriptions(NOW, slowNotify, BOT, invoicer);
    expect(r).toMatchObject({ action: "skipped", detail: "уже сделано" });
    expect(bot().status).toBe("active");
    expect(sent).toEqual([]);
    expect(markers()).toEqual([]);
  });

  it("счёт за период — выставляется один раз", async () => {
    setup(day(2));
    let invoices = 0;
    const invoicing = async () => {
      invoices++;
      await network();
      return { amount: 19_900, delivered: true };
    };
    await Promise.all([
      sweepSubscriptions(NOW, slowNotify, BOT, invoicing),
      sweepSubscriptions(NOW, slowNotify, BOT, invoicing),
    ]);
    expect(invoices).toBe(1);
    expect(markers().filter((m) => m?.startsWith("invoice:"))).toHaveLength(1);
  });

  it("недоставленное предупреждение не гасит день: следующий проход повторит", async () => {
    setup(day(2));
    const failing = async () => ({ ok: false, detail: "нет получателей" });
    expect((await sweepSubscriptions(NOW, failing, BOT, invoicer))[0]!.action).toBe("failed");
    expect((await sweep())[0]!.action).toBe("warned");
  });

  it("пробный период: общее предупреждение не шлёт (напоминает отдельный обход), счёт выставляет", async () => {
    setup(day(2), { billing: { trial_until: day(2).slice(0, 10) } });
    let invoiced = 0;
    const [r] = await sweepSubscriptions(NOW, notify, BOT, async () => {
      invoiced++;
      return { amount: 9900, delivered: true };
    });
    expect(r).toMatchObject({ state: "expiring", action: "skipped" });
    expect(sent).toEqual([]);
    expect(invoiced).toBe(1);
  });

  it("после пробного периода предупреждает как обычно", async () => {
    setup(day(-1), { billing: { trial_until: day(-1).slice(0, 10) } });
    const [r] = await sweep();
    expect(r).toMatchObject({ state: "overdue", action: "warned" });
    expect(sent).toHaveLength(1);
  });
});
