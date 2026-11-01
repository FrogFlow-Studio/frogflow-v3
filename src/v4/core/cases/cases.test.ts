import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgliteV4, v4Db } from "../../test/pg";
import {
  createOrder,
  decideReceipt,
  recordChargeback,
  recordPayment,
  submitReceipt,
} from "../money/money";
import {
  botMayReply,
  CASE_KINDS,
  CASE_OWNERS,
  cantPay,
  claimNotifications,
  finishNotification,
  handToSeller,
  NOTIFICATION_STATUSES,
  openCase,
  tick,
} from "./cases";

/**
 * Дела и сроки v4 на настоящем Postgres (PGlite). Примеры из разборов:
 * чек №1860 AATeach висел 5 дней; 85 диалогов BOVI «у менеджера» неделями.
 * Время магазина — Алматы (UTC+5), часы по умолчанию 10–19, пн–сб.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
let pg: PGlite;
const svc = () => pgliteV4(pg);
const asA = () => pgliteV4(pg, { botId: A });
const asB = () => pgliteV4(pg, { botId: B });
const fp = (n: number) => n.toString(16).padStart(64, "0");
const at = (iso: string) => new Date(iso);
const H = 3_600_000;

let product: string;
async function buyer(bot = A) {
  return (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country) values ($1, 'KZ') returning id",
      [bot],
    )
  ).rows[0]!.id;
}
async function order(b: string, isTest = false) {
  const r = await createOrder(asA(), {
    botId: A,
    buyerId: b,
    country: "KZ",
    productIds: [product],
    isTest,
    by: "bot",
  });
  if (!r.ok) throw new Error(r.code);
  return r.value;
}
async function caseOf(kind: string, orderId?: string) {
  const r = await pg.query<{
    id: string;
    status: string;
    owner: string;
    level: number;
    due_at: Date | null;
  }>(
    "select id, status, owner, level, due_at from v4.cases where bot_id = $1 and kind = $2 and ($3::uuid is null or order_id = $3) order by created_at desc limit 1",
    [A, kind, orderId ?? null],
  );
  return r.rows[0];
}
async function notes(caseId: string) {
  return (
    await pg.query<{ kind: string; audience: string }>(
      "select kind, audience from v4.notifications where case_id = $1 order by id",
      [caseId],
    )
  ).rows;
}

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT'), ($2, 'KZT')", [
    A,
    B,
  ]);
  product = (
    await pg.query<{ id: string }>(
      "insert into v4.products (bot_id, title, kind, base_price_minor) values ($1, 'Тетрадь', 'file', 300000) returning id",
      [A],
    )
  ).rows[0]!.id;
});
afterAll(async () => pg.close());

describe("списки в TS и в базе совпадают (решение 70)", () => {
  it("виды дел = правила сроков", async () => {
    const r = await pg.query<{ kind: string }>("select kind from v4.case_policies order by kind");
    expect(r.rows.map((x) => x.kind)).toEqual([...CASE_KINDS].sort());
  });
  it("владельцы и статусы уведомлений", async () => {
    const defs = (
      await pg.query<{ def: string }>(
        "select pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname in ('cases', 'notifications') and c.contype = 'c'",
      )
    ).rows.map((x) => x.def);
    const values = (col: string) =>
      [
        ...(
          defs.find((d) => d.includes(`(${col} = ANY`) || d.includes(`((${col})::text = ANY`)) ?? ""
        ).matchAll(/'([a-z_]+)'::text/g),
      ]
        .map((m) => m[1])
        .sort();
    expect(values("owner")).toEqual([...CASE_OWNERS].sort());
    expect(values("status").length).toBeGreaterThan(0);
    expect(NOTIFICATION_STATUSES).toContain("unknown");
  });
});

describe("рабочие часы магазина", () => {
  const add = async (from: string, hours: number) =>
    (
      await pg.query<{ t: Date }>("select v4.add_work_hours($1, $2, $3) as t", [A, from, hours])
    ).rows[0]!.t.toISOString();
  it("пятница 18:00 + 4 ч → суббота 13:00 (Алматы)", async () => {
    expect(await add("2026-11-06T18:00:00+05:00", 4)).toBe("2026-11-07T08:00:00.000Z");
  });
  it("суббота 18:00 + 4 ч → понедельник 13:00: воскресенье выходной", async () => {
    expect(await add("2026-11-07T18:00:00+05:00", 4)).toBe("2026-11-09T08:00:00.000Z");
  });
  it("понедельник 08:00 + 4 ч → 14:00: до открытия время не идёт", async () => {
    expect(await add("2026-11-09T08:00:00+05:00", 4)).toBe("2026-11-09T09:00:00.000Z");
  });
});

describe("чек ждёт: 2 ч — напоминание продавцу, 24 ч — оператору (решение 3)", () => {
  it("№1860 больше не висит 5 дней: шаги идут один раз, принятый чек закрывает дело", async () => {
    const o = await order(await buyer());
    const r = await submitReceipt(asA(), {
      botId: A,
      orderId: o.id,
      storagePath: `${A}/1860.jpg`,
      fingerprint: fp(1860),
    });
    if (!r.ok) throw new Error(r.code);
    const c = (await caseOf("receipt_review", o.id))!;
    expect(c).toMatchObject({ status: "open", owner: "seller", level: 0 });
    expect(await notes(c.id)).toEqual([{ kind: "case_opened:receipt_review", audience: "seller" }]);

    const t0 = Date.now();
    await tick(svc(), new Date(t0 + 1 * H));
    expect((await caseOf("receipt_review", o.id))!.level).toBe(0);
    // два тика одновременно (два крона) — одно напоминание
    await Promise.all([tick(svc(), new Date(t0 + 2.1 * H)), tick(svc(), new Date(t0 + 2.1 * H))]);
    expect((await caseOf("receipt_review", o.id))!).toMatchObject({ level: 1, owner: "seller" });
    await tick(svc(), new Date(t0 + 25 * H));
    expect((await caseOf("receipt_review", o.id))!).toMatchObject({ level: 2, owner: "operator" });
    expect((await notes(c.id)).map((n) => `${n.audience}:${n.kind}`)).toEqual([
      "seller:case_opened:receipt_review",
      "seller:case_reminder:receipt_review",
      "operator:case_escalated:receipt_review",
    ]);

    await decideReceipt(asA(), {
      botId: A,
      receiptId: r.value.id,
      accept: true,
      amountMinor: 300_000,
      by: "operator",
    });
    expect((await caseOf("receipt_review", o.id))!.status).toBe("closed");
  });
});

describe("«у продавца» со сроком (решение 7)", () => {
  it("бот молчит, пока диалог у продавца; через 4 рабочих часа снова отвечает", async () => {
    const b = await buyer();
    // понедельник 11:00 Алматы
    await pg.query(
      "select v4.open_case($1, 'handoff', 'buyer:' || $2, 'bot', $2::uuid, null, '{}'::jsonb, '2026-11-09T11:00:00+05:00')",
      [A, b],
    );
    expect(await botMayReply(asA(), A, b)).toBe(false);
    const again = await handToSeller(asA(), {
      botId: A,
      buyerId: b,
      reason: "ещё вопрос",
      by: "bot",
    });
    const open = await pg.query(
      "select count(*)::int as n from v4.cases where buyer_id = $1 and kind = 'handoff'",
      [b],
    );
    expect(open.rows).toEqual([{ n: 1 }]);
    expect(again).toBeTruthy();

    await tick(svc(), at("2026-11-09T14:59:00+05:00"));
    expect(await botMayReply(asA(), A, b)).toBe(false);
    await tick(svc(), at("2026-11-09T15:00:00+05:00"));
    expect(await botMayReply(asA(), A, b)).toBe(true);
    const ev = await pg.query<{ kind: string }>(
      "select e.kind from v4.case_events e join v4.cases c on c.id = e.case_id where c.buyer_id = $1 order by e.id",
      [b],
    );
    expect(ev.rows.map((e) => e.kind)).toEqual(["opened", "repeated", "returned_to_bot"]);
  });
});

describe("дела из денег (связь с этапом 1)", () => {
  it("недоплата открывает дело, доплата его закрывает", async () => {
    const o = await order(await buyer());
    await recordPayment(asA(), {
      botId: A,
      orderId: o.id,
      amountMinor: 177_500,
      currency: "KZT",
      method: "transfer",
      externalRef: "u1",
      by: "t",
    });
    expect((await caseOf("underpaid", o.id))!.status).toBe("open");
    await recordPayment(asA(), {
      botId: A,
      orderId: o.id,
      amountMinor: 122_500,
      currency: "KZT",
      method: "transfer",
      externalRef: "u2",
      by: "t",
    });
    expect((await caseOf("underpaid", o.id))!.status).toBe("closed");
  });

  it("отмена оплаты картой и деньги по закрытому заказу — дела продавцу", async () => {
    const o = await order(await buyer());
    await recordPayment(asA(), {
      botId: A,
      orderId: o.id,
      amountMinor: 300_000,
      currency: "KZT",
      method: "prodamus",
      externalRef: "cb1",
      by: "t",
    });
    await recordChargeback(asA(), {
      botId: A,
      orderId: o.id,
      amountMinor: 300_000,
      currency: "KZT",
      method: "prodamus",
      externalRef: "cb1",
      by: "t",
    });
    expect((await caseOf("chargeback", o.id))!).toMatchObject({ status: "open", owner: "seller" });

    const o2 = await order(await buyer());
    await pg.query("select v4.close_order($1, $2, 'expired', 'тест', 't')", [A, o2.id]);
    await recordPayment(asA(), {
      botId: A,
      orderId: o2.id,
      amountMinor: 300_000,
      currency: "KZT",
      method: "transfer",
      externalRef: "late",
      by: "t",
    });
    expect((await caseOf("payment_on_closed", o2.id))!.status).toBe("open");
  });

  it("пробный заказ дел не открывает (31)", async () => {
    const o = await order(await buyer(), true);
    await recordPayment(asA(), {
      botId: A,
      orderId: o.id,
      amountMinor: 1000,
      currency: "KZT",
      method: "transfer",
      externalRef: "test-u",
      by: "t",
    });
    expect(await caseOf("underpaid", o.id)).toBeUndefined();
  });
});

describe("«не получается оплатить» (решение 41)", () => {
  it("одно дело на покупателя, причины считаются по неделям", async () => {
    const b = await buyer();
    const first = await cantPay(asA(), { botId: A, buyerId: b, reason: "нет Kaspi", by: "bot" });
    const second = await cantPay(asA(), { botId: A, buyerId: b, reason: "нет Kaspi", by: "bot" });
    expect(first.ok && first.value.created).toBe(true);
    expect(second.ok && [second.value.created, second.value.caseId]).toEqual([
      false,
      first.ok && first.value.caseId,
    ]);
    await cantPay(asA(), { botId: A, buyerId: await buyer(), reason: "нет Kaspi", by: "bot" });
    const r = await pg.query<{ cases: number }>(
      "select sum(cases)::int as cases from v4.cant_pay_reasons where bot_id = $1 and reason = 'нет Kaspi'",
      [A],
    );
    expect(r.rows).toEqual([{ cases: 2 }]);
  });

  it("неизвестный вид дела — отказ", async () => {
    expect(
      await openCase(asA(), { botId: A, kind: "nope" as never, dedupeKey: "x", by: "t" }),
    ).toEqual({ ok: false, code: "unknown_case_kind" });
  });
});

describe("уведомления — один раз (решения 66, 67)", () => {
  it("забранное не забирается второй раз; «могло дойти» не повторяется", async () => {
    await pg.query("select v4.notify($1, 'seller', 'now', 'test_kind', 'n-1')", [A]);
    await pg.query("select v4.notify($1, 'seller', 'now', 'test_kind', 'n-1')", [A]);
    const all = await claimNotifications(svc(), "now", 500);
    const mine = all.filter((n) => n.kind === "test_kind");
    expect(mine).toHaveLength(1);
    expect(
      (await claimNotifications(svc(), "now", 500)).filter((n) => n.kind === "test_kind"),
    ).toEqual([]);
    expect(await finishNotification(svc(), mine[0]!.id, "unknown", "timeout")).toBe(true);
    expect(await finishNotification(svc(), mine[0]!.id, "sent")).toBe(false);
    const st = await pg.query("select status from v4.notifications where id = $1", [mine[0]!.id]);
    expect(st.rows).toEqual([{ status: "unknown" }]);
  });

  it("отправка упала посреди (аренда истекла) → unknown, не повтор", async () => {
    await pg.query("select v4.notify($1, 'operator', 'digest', 'lease_kind', 'n-2')", [A]);
    const [n] = (await claimNotifications(svc(), "digest", 500)).filter(
      (x) => x.kind === "lease_kind",
    );
    const r = await tick(svc(), new Date(Date.now() + 10 * 60_000));
    expect(r.notificationsUnknown).toBeGreaterThanOrEqual(1);
    const st = await pg.query("select status from v4.notifications where id = $1", [n!.id]);
    expect(st.rows).toEqual([{ status: "unknown" }]);
  });
});

describe("очередь задач в базе (решение 28)", () => {
  it("ключ «один раз», аренда, попытки кончаются — failed", async () => {
    expect((await pg.query("select v4.enqueue_job('demo', 'k1', $1) as ok", [A])).rows).toEqual([
      { ok: true },
    ]);
    expect((await pg.query("select v4.enqueue_job('demo', 'k1', $1) as ok", [A])).rows).toEqual([
      { ok: false },
    ]);
    await pg.query("update v4.jobs set max_attempts = 2 where kind = 'demo'");
    const now = Date.now();
    const claim = async (ms: number) =>
      (
        await pg.query<{ id: number }>(
          "select id from v4.claim_jobs(10, '2 minutes', $1) where kind = 'demo'",
          [new Date(now + ms).toISOString()],
        )
      ).rows;
    expect(await claim(0)).toHaveLength(1);
    expect(await claim(1000)).toHaveLength(0); // аренда держит
    expect(await claim(3 * 60_000)).toHaveLength(1); // аренда истекла — вторая попытка
    expect(await claim(6 * 60_000)).toHaveLength(0); // попытки кончились
    expect((await pg.query("select status from v4.jobs where kind = 'demo'")).rows).toEqual([
      { status: "failed" },
    ]);
  });
});

describe("изоляция и права", () => {
  it("чужие дела не видны; арендатор не запускает планировщик", async () => {
    await cantPay(asA(), { botId: A, buyerId: await buyer(), reason: "x", by: "bot" });
    const seen = await pg.transaction(async (tx) => {
      await tx.query("set local role tenant_bot");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ bot_id: B }),
      ]);
      return (await tx.query("select count(*)::int as n from v4.cases")).rows;
    });
    expect(seen).toEqual([{ n: 0 }]);
    await expect(tick(asB())).rejects.toThrow(/permission denied|не выполнилась/);
  });

  it("планировщик истекает заказы всех магазинов v4", async () => {
    const o = await order(await buyer());
    const r = await tick(svc(), new Date(Date.now() + 8 * 24 * H));
    expect(r.ordersExpired).toBeGreaterThanOrEqual(1);
    expect((await pg.query("select status from v4.orders where id = $1", [o.id])).rows).toEqual([
      { status: "expired" },
    ]);
  });
});
