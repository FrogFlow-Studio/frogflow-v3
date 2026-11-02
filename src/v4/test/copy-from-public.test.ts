import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v4Db } from "./pg";

/**
 * Перенос клиента из public в v4 (scripts/v4/copy-from-public.sql) на
 * настоящем Postgres: таблицы v3 — только нужные колонки, данные — в форме
 * Копилки (ключи ig_/tg_/wa_, варианты, файлы ru/kk, цены {"KZ","RU"},
 * VIP-участники вне основного бота). public только читается.
 */

const BOT = "4f9562e2-0000-4000-8000-000000000001";
const OTHER = "4f9562e2-0000-4000-8000-000000000002";
const P1 = "11111111-0000-4000-8000-000000000001";
const P2 = "11111111-0000-4000-8000-000000000002";
const V1 = "22222222-0000-4000-8000-000000000001";
const T1 = "33333333-0000-4000-8000-000000000001";
let pg: PGlite;
type Report = {
  copied: Record<string, number>;
  order_counter: number;
  not_copied: Record<string, number>;
  v4_totals: Record<string, number>;
};
const copy = async () =>
  (await pg.query<{ r: Report }>("select v4.copy_from_public($1) r", [BOT])).rows[0]!.r;

beforeAll(async () => {
  pg = await v4Db();
  await pg.exec(`
    create table public.bots (id uuid primary key, settings jsonb not null default '{}');
    create table public.bot_users (bot_id uuid, user_key text, platform text, telegram_id bigint,
      first_name text, last_name text, language_code text, email text, loyalty_points integer,
      zernio_conversation_id text, zernio_account_id text, created_at timestamptz default now());
    create table public.products (id uuid primary key, bot_id uuid, name text, price numeric, currency text,
      is_active boolean, country_prices jsonb, created_at timestamptz default now());
    create table public.product_variants (id uuid primary key, bot_id uuid, product_id uuid, name text,
      price numeric, sort_order integer);
    create table public.product_material_files (id uuid primary key default gen_random_uuid(), bot_id uuid,
      product_id uuid, language text, file_path text, file_name text, sort_order integer);
    create table public.payment_methods (id uuid primary key default gen_random_uuid(), bot_id uuid,
      country_code text, currency text, instructions text, is_active boolean);
    create table public.orders (id bigint primary key, bot_id uuid, user_key text, status text,
      country_code text, order_no bigint, display_no bigint, created_at timestamptz default now());
    create table public.order_items (id uuid primary key default gen_random_uuid(), order_id bigint,
      product_id uuid, product_variant_id uuid, bot_id uuid);
    create table public.vip_tariffs (id uuid primary key, bot_id uuid, name text, price numeric, currency text,
      duration_days integer, duration_minutes integer, is_active boolean);
    create table public.vip_subscriptions (id uuid primary key default gen_random_uuid(), bot_id uuid,
      telegram_id bigint, first_name text, last_name text, tariff_id uuid, status text,
      started_at timestamptz, expires_at timestamptz, created_at timestamptz default now());
  `);
  await pg.exec(readFileSync("scripts/v4/copy-from-public.sql", "utf8"));
  await pg.query("insert into public.bots values ($1, '{\"timezone\": \"\"}'), ($2, '{}')", [
    BOT,
    OTHER,
  ]);
  await pg.query(
    `insert into public.bot_users (bot_id, user_key, platform, telegram_id, first_name, language_code, loyalty_points) values
      ($1, 'ig_1746922216556948', 'instagram', -1, 'Айгерим', 'kk', 120),
      ($1, 'tg_555', 'telegram', 555, 'Мария', 'ru', 0),
      ($1, 'wa_77010000000', 'whatsapp', -2, null, 'de', null),
      ($1, null, 'telegram', 9, 'Без ключа', null, 50),
      ($2, 'ig_999', 'instagram', -3, 'Чужой', 'ru', 500)`,
    [BOT, OTHER],
  );
  await pg.query(
    "update public.bot_users set zernio_conversation_id = 'conv-ig-1', zernio_account_id = 'acc-ig-2' where user_key = 'ig_1746922216556948'",
  );
  await pg.query(
    `insert into public.products (id, bot_id, name, price, currency, is_active, country_prices) values
      ($1, $3, 'Рабочая тетрадь', 1500, 'KZT', true, '{"KZ": 1500, "RU": 490}'),
      ($2, $3, 'Старый курс', 900, 'KZT', false, null)`,
    [P1, P2, BOT],
  );
  await pg.query(
    "insert into public.product_variants values ($1, $2, $3, '5 класс', 1700, 1), (gen_random_uuid(), $2, $3, ' ', 1, 2)",
    [V1, BOT, P1],
  );
  await pg.query(
    `insert into public.product_material_files (bot_id, product_id, language, file_path, file_name, sort_order) values
      ($1, $2, 'ru', 'kop/5-ru-1.pdf', '5 класс (ru).pdf', 1), ($1, $2, 'ru', 'kop/5-ru-2.pdf', '', 2),
      ($1, $2, 'kk', 'kop/5-kk.pdf', '5 сынып.pdf', 1)`,
    [BOT, P1],
  );
  await pg.query(
    "insert into public.payment_methods (bot_id, country_code, currency, instructions, is_active) values ($1, 'KZ', 'KZT', 'Kaspi 8 700 …', true)",
    [BOT],
  );
  await pg.query(
    `insert into public.orders values
      (1, $1, 'ig_1746922216556948', 'delivered', 'KZ', 273, 273, now() - interval '3 days'),
      (2, $1, 'tg_555', 'awaiting_confirmation', 'KZ', 274, 274, now()),
      (3, $1, 'tg_555', 'delivered', 'RU', 270, 270, now() - interval '9 days')`,
    [BOT],
  );
  await pg.query(
    `insert into public.order_items (order_id, product_id, product_variant_id, bot_id) values
      (1, $1, $2, $3), (3, $1, null, $3), (3, null, null, $3), (2, $1, null, $3)`,
    [P1, V1, BOT],
  );
  await pg.query(
    "insert into public.vip_tariffs values ($1, $2, 'VIP-клуб', 5000, 'KZT', 30, null, true)",
    [T1, BOT],
  );
  await pg.query(
    `insert into public.vip_subscriptions (bot_id, telegram_id, first_name, tariff_id, status, started_at, expires_at) values
      ($1, 555, 'Мария', $2, 'active', now() - interval '10 days', now() + interval '20 days'),
      ($1, 777, 'Вне бота', $2, 'active', now() - interval '5 days', now() + interval '25 days'),
      ($1, 888, 'Не оплатила', $2, 'pending_payment', null, now() + interval '30 days'),
      ($1, 999, 'Истекла', $2, 'active', now() - interval '40 days', now() - interval '10 days')`,
    [BOT, T1],
  );
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("copy_from_public", () => {
  it("переносит магазин Копилки и честно говорит, что не перенесено", async () => {
    const r = await copy();
    expect(r.copied).toEqual({
      buyers: 3,
      channels: 3,
      points_balances: 1,
      products: 2,
      variants: 1,
      country_prices: 1,
      files: 3,
      payment_methods: 1,
      clubs: 1,
      club_access: 2,
      file_access: 2,
    });
    expect(r.order_counter).toBe(274);
    expect(r.not_copied).toEqual({
      open_orders: 1,
      vip_not_active: 2,
      items_without_product: 1,
      products_not_kzt: 0,
      users_without_key: 1,
    });
    expect(r.v4_totals.points_migrated).toBe(r.v4_totals.points_in_v3);
  });

  it("повторный запуск ничего не дублирует", async () => {
    const r = await copy();
    expect(Object.values(r.copied).every((n) => n === 0)).toBe(true);
    expect(r.v4_totals).toMatchObject({ buyers: 4, products: 4, access: 4 });
  });

  it("цены, файлы по языку, вариант и часовой пояс как в v3", async () => {
    const q = async <T>(sql: string, args: unknown[] = []) =>
      (await pg.query<T & Record<string, unknown>>(sql, args)).rows;
    expect(await q("select timezone from v4.shops where bot_id = $1", [BOT])).toEqual([
      { timezone: "Asia/Almaty" },
    ]);
    expect(
      await q("select currency, amount_minor::int from v4.product_prices where product_id = $1", [
        P1,
      ]),
    ).toEqual([{ currency: "RUB", amount_minor: 49000 }]);
    expect(
      await q("select variant_label, base_price_minor::int from v4.products where id = $1", [V1]),
    ).toEqual([{ variant_label: "5 класс", base_price_minor: 170000 }]);
    expect((await q("select status from v4.products where id = $1", [P2]))[0]).toEqual({
      status: "archived",
    });
    const kk = await q<{ storage_path: string }>(
      "select storage_path from v4.files_for($1, $2, 'kk')",
      [BOT, P1],
    );
    expect(kk.map((f) => f.storage_path)).toEqual(["kop/5-kk.pdf"]);
    const en = await q<{ storage_path: string }>(
      "select storage_path from v4.files_for($1, $2, 'en')",
      [BOT, P1],
    );
    expect(en).toHaveLength(3);
  });

  it("VIP: участник вне основного бота получает покупателя и доступ до своего срока", async () => {
    const rows = (
      await pg.query<{ external_id: string; ends_in_days: number }>(
        `select bc.external_id, round(extract(epoch from a.ends_at - now()) / 86400)::int ends_in_days
         from v4.access a join v4.buyer_channels bc on bc.buyer_id = a.buyer_id and bc.channel = 'telegram'
         where a.bot_id = $1 and a.kind = 'club' order by bc.external_id`,
        [BOT],
      )
    ).rows;
    expect(rows).toEqual([
      { external_id: "555", ends_in_days: 20 },
      { external_id: "777", ends_in_days: 25 },
    ]);
  });

  it("переписка и аккаунт Zernio переносятся в канал покупателя (нужны для выдачи в Direct)", async () => {
    const rows = (
      await pg.query<{
        channel: string;
        conversation_id: string | null;
        account_id: string | null;
      }>(
        "select channel, conversation_id, account_id from v4.buyer_channels where bot_id = $1 order by channel",
        [BOT],
      )
    ).rows;
    expect(rows.find((r) => r.channel === "instagram")?.conversation_id).toBe("conv-ig-1");
    expect(rows.find((r) => r.channel === "instagram")?.account_id).toBe("acc-ig-2");
    expect(rows.find((r) => r.channel === "telegram")?.conversation_id).toBeNull();
  });

  it("чужой магазин и public не тронуты", async () => {
    expect(
      (await pg.query("select 1 from v4.buyers where bot_id = $1", [OTHER])).rows,
    ).toHaveLength(0);
    expect(
      (await pg.query<{ n: number }>("select count(*)::int n from public.bot_users")).rows[0]!.n,
    ).toBe(5);
  });
});
