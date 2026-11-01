import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgliteV4, v4Db } from "../../test/pg";
import {
  closeOrder,
  createOrder,
  decideReceipt,
  recordPayment,
  submitReceipt,
} from "../money/money";
import {
  ACCESS_KINDS,
  ACCESS_STATUSES,
  cabinetItems,
  deliveryResult,
  DELIVERY_CHANNELS,
  issueCabinetLink,
  revokeAccess,
} from "./access";

/**
 * Выдача и доступы v4 на настоящем Postgres (PGlite). Примеры из разборов:
 * у Копилки свой файл на каждый класс («5 класс.rar»), VIP-клуб с продлением,
 * «потерял файл» → ссылка в кабинет.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const B = "bbbbbbbb-0000-4000-8000-0000000000c2";
const DAY = 86_400_000;
let pg: PGlite;
const svc = () => pgliteV4(pg);
const asA = () => pgliteV4(pg, { botId: A });
const asB = () => pgliteV4(pg, { botId: B });

let notebook: string;
let grade5: string;
let club: string;
let club1m: string;
let club3m: string;

async function product(fields: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(fields);
  const r = await pg.query<{ id: string }>(
    `insert into v4.products (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    cols.map((c) => fields[c]),
  );
  return r.rows[0]!.id;
}
async function buyer(bot = A) {
  return (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country) values ($1, 'KZ') returning id",
      [bot],
    )
  ).rows[0]!.id;
}
async function buy(b: string, productId: string, ref: string) {
  const o = await createOrder(asA(), {
    botId: A,
    buyerId: b,
    country: "KZ",
    productIds: [productId],
    by: "bot",
  });
  if (!o.ok) throw new Error(o.code);
  const p = await recordPayment(asA(), {
    botId: A,
    orderId: o.value.id,
    amountMinor: o.value.totalMinor,
    currency: "KZT",
    method: "transfer",
    externalRef: ref,
    by: "t",
  });
  if (!p.ok) throw new Error(p.code);
  return o.value;
}
const accessOf = async (b: string) =>
  (
    await pg.query<{
      id: string;
      product_id: string;
      status: string;
      starts_at: Date;
      ends_at: Date | null;
      order_id: string;
    }>(
      "select id, product_id, status, starts_at, ends_at, order_id from v4.access where buyer_id = $1 order by starts_at, id",
      [b],
    )
  ).rows;
const jobs = async (kind: string, accessId: string) =>
  (
    await pg.query("select 1 from v4.jobs where kind = $1 and payload ->> 'access_id' = $2", [
      kind,
      accessId,
    ])
  ).rows.length;

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT'), ($2, 'KZT')", [
    A,
    B,
  ]);
  notebook = await product({
    bot_id: A,
    title: "Рабочая тетрадь",
    kind: "file",
    base_price_minor: 150_000,
  });
  grade5 = await product({
    bot_id: A,
    title: "Рабочая тетрадь",
    kind: "file",
    base_price_minor: 150_000,
    parent_id: notebook,
    variant_label: "5 класс",
    storage_path: `${A}/5 класс.rar`,
    file_bytes: 40_000_000,
  });
  await product({
    bot_id: A,
    title: "Рабочая тетрадь",
    kind: "file",
    base_price_minor: 150_000,
    parent_id: notebook,
    variant_label: "6 класс",
    storage_path: `${A}/6 класс.rar`,
    file_bytes: 42_000_000,
  });
  club = await product({
    bot_id: A,
    title: "VIP-клуб",
    kind: "club",
    base_price_minor: 500_000,
    club_chat_id: "-100123",
  });
  club1m = await product({
    bot_id: A,
    title: "VIP-клуб",
    kind: "club",
    base_price_minor: 500_000,
    parent_id: club,
    variant_label: "1 месяц",
    term: "30 days",
  });
  club3m = await product({
    bot_id: A,
    title: "VIP-клуб",
    kind: "club",
    base_price_minor: 1_300_000,
    parent_id: club,
    variant_label: "3 месяца",
    term: "90 days",
  });
});
afterAll(async () => pg.close());

describe("списки в TS и в базе совпадают", () => {
  it("виды, статусы доступа и каналы выдачи", async () => {
    const defs = (
      await pg.query<{ def: string }>(
        "select pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace where n.nspname = 'v4' and t.relname in ('access', 'deliveries') and c.contype = 'c'",
      )
    ).rows.map((x) => x.def);
    const values = (col: string) =>
      [
        ...(defs.find((d) => d.startsWith(`CHECK ((${col} = ANY`)) ?? "").matchAll(
          /'([a-z_]+)'::text/g,
        ),
      ]
        .map((m) => m[1])
        .sort();
    expect(values("kind")).toEqual([...ACCESS_KINDS].sort());
    expect(values("status").length).toBeGreaterThan(0);
    expect(values("channel")).toEqual([...DELIVERY_CHANNELS].sort());
    expect(ACCESS_STATUSES).toEqual(["active", "expired", "revoked"]);
  });
});

describe("вариант со своим файлом (решение 94)", () => {
  it("товар с вариантами сам не продаётся — только класс", async () => {
    const r = await createOrder(asA(), {
      botId: A,
      buyerId: await buyer(),
      country: "KZ",
      productIds: [notebook],
      by: "bot",
    });
    expect(r).toEqual({ ok: false, code: "choose_variant" });
  });

  it("оплата выдаёт доступ к файлу класса один раз; заказ выполнен; повтор вебхука ничего не добавляет", async () => {
    const b = await buyer();
    const o = await buy(b, grade5, "g5-1");
    await recordPayment(asA(), {
      botId: A,
      orderId: o.id,
      amountMinor: o.totalMinor,
      currency: "KZT",
      method: "transfer",
      externalRef: "g5-1",
      by: "t",
    });
    const acc = await accessOf(b);
    expect(acc).toHaveLength(1);
    expect(acc[0]).toMatchObject({ product_id: grade5, status: "active", ends_at: null });
    expect(await jobs("deliver", acc[0]!.id)).toBe(1);
    expect((await pg.query("select status from v4.orders where id = $1", [o.id])).rows).toEqual([
      { status: "fulfilled" },
    ]);
  });

  it("продавец принимает чек под своей ролью — выдача ставится в очередь (задачи арендатор не видит)", async () => {
    const b = await buyer();
    const o = await createOrder(asA(), {
      botId: A,
      buyerId: b,
      country: "KZ",
      productIds: [grade5],
      by: "bot",
    });
    if (!o.ok) throw new Error(o.code);
    const r = await submitReceipt(asA(), {
      botId: A,
      orderId: o.value.id,
      storagePath: `${A}/r.jpg`,
      fingerprint: "c".repeat(64),
    });
    if (!r.ok) throw new Error(r.code);
    const d = await decideReceipt(asA(), {
      botId: A,
      receiptId: r.value.id,
      accept: true,
      amountMinor: 150_000,
      by: "seller",
    });
    expect(d).toMatchObject({ ok: true, value: { becamePaid: true } });
    const acc = await accessOf(b);
    expect(acc).toHaveLength(1);
    expect(await jobs("deliver", acc[0]!.id)).toBe(1);
  });

  it("деньги по истёкшему заказу доступ не выдают — это дело продавцу", async () => {
    const b = await buyer();
    const o = await createOrder(asA(), {
      botId: A,
      buyerId: b,
      country: "KZ",
      productIds: [grade5],
      by: "bot",
    });
    if (!o.ok) throw new Error(o.code);
    await closeOrder(asA(), {
      botId: A,
      orderId: o.value.id,
      status: "expired",
      reason: "7 дней",
      by: "cron",
    });
    await recordPayment(asA(), {
      botId: A,
      orderId: o.value.id,
      amountMinor: 150_000,
      currency: "KZT",
      method: "transfer",
      externalRef: "late-g5",
      by: "t",
    });
    expect(await accessOf(b)).toEqual([]);
    expect(
      (
        await pg.query(
          "select status from v4.cases where order_id = $1 and kind = 'payment_on_closed'",
          [o.value.id],
        )
      ).rows,
    ).toEqual([{ status: "open" }]);
  });
});

describe("клуб со сроком и продлением (решения 11, 101)", () => {
  it("продление начинается с конца срока; из группы не убираем, пока идёт оплаченный срок", async () => {
    const b = await buyer();
    await buy(b, club1m, "club-1");
    await buy(b, club3m, "club-2");
    const [first, second] = await accessOf(b);
    expect(second!.starts_at.getTime()).toBe(first!.ends_at!.getTime());
    expect(second!.ends_at!.getTime() - second!.starts_at.getTime()).toBe(90 * DAY);
    expect(await jobs("club_invite", first!.id)).toBe(1);

    const now = Date.now();
    // за 2 дня до конца первого срока напоминания нет: следующий срок уже оплачен
    await pg.query("select v4.expire_access($1)", [
      new Date(first!.ends_at!.getTime() - 2 * DAY).toISOString(),
    ]);
    expect(
      (
        await pg.query("select 1 from v4.notifications where dedupe_key = $1", [
          `renew:${first!.id}`,
        ])
      ).rows,
    ).toEqual([]);
    // первый срок кончился — из группы не убираем
    await pg.query("select v4.expire_access($1)", [
      new Date(first!.ends_at!.getTime() + 60_000).toISOString(),
    ]);
    expect((await accessOf(b)).map((a) => a.status)).toEqual(["expired", "active"]);
    expect(await jobs("club_remove", first!.id)).toBe(0);
    // за 2 дня до конца второго — одно напоминание, даже если тик дважды
    const before = new Date(second!.ends_at!.getTime() - 2 * DAY).toISOString();
    await pg.query("select v4.expire_access($1)", [before]);
    await pg.query("select v4.expire_access($1)", [before]);
    expect(
      (
        await pg.query("select count(*)::int as n from v4.notifications where dedupe_key = $1", [
          `renew:${second!.id}`,
        ])
      ).rows,
    ).toEqual([{ n: 1 }]);
    // второй кончился — задача убрать из группы
    await pg.query("select v4.expire_access($1)", [
      new Date(second!.ends_at!.getTime() + 60_000).toISOString(),
    ]);
    expect(await jobs("club_remove", second!.id)).toBe(1);
    expect(now).toBeLessThan(second!.ends_at!.getTime());
  });

  it("участник, перенесённый с датами из v3, истекает по старому сроку (101)", async () => {
    const b = await buyer();
    const ends = new Date(Date.now() + 5 * DAY);
    const r = await pg.query<{ id: string }>(
      "insert into v4.access (bot_id, buyer_id, product_id, kind, source, starts_at, ends_at, created_by) values ($1, $2, $3, 'club', 'migration', now() - interval '25 days', $4, 'migration') returning id",
      [A, b, club1m, ends.toISOString()],
    );
    await pg.query("select v4.expire_access($1)", [new Date(ends.getTime() + 1000).toISOString()]);
    expect((await accessOf(b)).map((a) => a.status)).toEqual(["expired"]);
    expect(await jobs("club_remove", r.rows[0]!.id)).toBe(1);
  });

  it("отзыв клуба (возврат) — с причиной, задача убрать из группы", async () => {
    const b = await buyer();
    await buy(b, club1m, "club-revoke");
    const [a] = await accessOf(b);
    expect(await revokeAccess(asA(), { botId: A, accessId: a!.id, reason: "", by: "s" })).toEqual({
      ok: false,
      code: "reason_required",
    });
    expect(
      await revokeAccess(asA(), { botId: A, accessId: a!.id, reason: "Возврат", by: "s" }),
    ).toEqual({ ok: true, value: true });
    expect(
      await revokeAccess(asA(), { botId: A, accessId: a!.id, reason: "Возврат", by: "s" }),
    ).toEqual({ ok: true, value: false });
    expect(await jobs("club_remove", a!.id)).toBe(1);
  });
});

describe("сбой выдачи — дело (решение 43)", () => {
  it("неудача открывает дело, повтор итога по каналу не пишется, выдача на почту закрывает дело", async () => {
    const b = await buyer();
    await buy(b, grade5, "deliv-1");
    const [a] = await accessOf(b);
    expect(
      await deliveryResult(asA(), {
        botId: A,
        accessId: a!.id,
        channel: "telegram",
        status: "unknown",
        error: "timeout",
      }),
    ).toEqual({ ok: true, value: true });
    expect(
      await deliveryResult(asA(), {
        botId: A,
        accessId: a!.id,
        channel: "telegram",
        status: "sent",
      }),
    ).toEqual({ ok: true, value: false });
    const c = await pg.query<{ status: string }>(
      "select status from v4.cases where kind = 'delivery_failed' and dedupe_key = $1",
      [`access:${a!.id}`],
    );
    expect(c.rows).toEqual([{ status: "open" }]);
    await deliveryResult(asA(), { botId: A, accessId: a!.id, channel: "email", status: "sent" });
    const c2 = await pg.query<{ status: string }>(
      "select status from v4.cases where kind = 'delivery_failed' and dedupe_key = $1",
      [`access:${a!.id}`],
    );
    expect(c2.rows).toEqual([{ status: "closed" }]);
  });
});

describe("кабинет покупателя по ссылке (решение 12)", () => {
  it("«потерял файл»: по ссылке видно свои доступы; чужая, неверная и старая ссылка — пусто", async () => {
    const b = await buyer();
    await buy(b, grade5, "cab-1");
    const { token } = await issueCabinetLink(svc(), A, b);
    const items = await cabinetItems(svc(), A, token);
    expect(items).toEqual([
      expect.objectContaining({
        title: "Рабочая тетрадь",
        variantLabel: "5 класс",
        kind: "file",
        storagePath: `${A}/5 класс.rar`,
      }),
    ]);
    expect(await cabinetItems(svc(), A, `${token}x`)).toEqual([]);
    expect(await cabinetItems(svc(), B, token)).toEqual([]);
    await pg.query(
      "update v4.cabinet_links set expires_at = now() - interval '1 second' where buyer_id = $1",
      [b],
    );
    expect(await cabinetItems(svc(), A, token)).toEqual([]);
    const stored = await pg.query<{ token_sha256: string }>(
      "select token_sha256 from v4.cabinet_links where buyer_id = $1",
      [b],
    );
    expect(stored.rows[0]!.token_sha256).not.toContain(token);
  });

  it("арендатор не читает ссылки кабинета и не открывает кабинет", async () => {
    await expect(cabinetItems(asA(), A, "x")).rejects.toThrow();
  });
});

describe("место под файлы (решение 19)", () => {
  it("лимит магазина и кандидаты на чистку", async () => {
    expect((await pg.query("select v4.storage_room($1, 1000) as ok", [A])).rows).toEqual([
      { ok: true },
    ]);
    await pg.query("update v4.shops set storage_limit_bytes = 50000000 where bot_id = $1", [A]);
    expect((await pg.query("select v4.storage_room($1, 1000) as ok", [A])).rows).toEqual([
      { ok: false },
    ]);
    const old = await product({
      bot_id: A,
      title: "Старое",
      kind: "file",
      base_price_minor: 1,
      storage_path: `${A}/old.pdf`,
      file_bytes: 10,
      status: "archived",
      archived_at: new Date(Date.now() - 100 * DAY).toISOString(),
    });
    const ids = (
      await pg.query<{ product_id: string }>(
        "select product_id from v4.storage_cleanup where bot_id = $1",
        [A],
      )
    ).rows.map((r) => r.product_id);
    expect(ids).toEqual([old]);
  });
});

describe("изоляция", () => {
  it("арендатор не ставит задачи чужому магазину и не видит чужие доступы", async () => {
    await expect(
      asB().call("enqueue_job", { p_kind: "deliver", p_dedupe_key: "evil", p_bot_id: A }),
    ).rejects.toThrow(/v4:foreign_bot/);
    const seen = await pg.transaction(async (tx) => {
      await tx.query("set local role tenant_bot");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ bot_id: B }),
      ]);
      return (await tx.query("select count(*)::int as n from v4.access")).rows;
    });
    expect(seen).toEqual([{ n: 0 }]);
  });
});
