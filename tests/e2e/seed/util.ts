/** Общие помощники сида: шифрование токена, хэш пароля, строки магазина. */
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import * as F from "../fixtures.ts";
import type { Row, StubDb } from "../pg-stub.ts";

export function encrypt(plain: string, hexKey: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(hexKey, "hex"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `enc:v1:${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`;
}

export function hash(password: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(password.normalize("NFKC"), salt, 64);
  return `scrypt:${salt.toString("base64url")}:${h.toString("base64url")}`;
}

export const nulls = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, null]));

/** Строка демо-магазина. */
export const shop = (r: Row) => ({ bot_id: F.SHOP_ID, ...r });

/** Дописывает строки в таблицу: разделы сида заполняют её независимо. */
export function add(db: StubDb, table: string, rows: Row[]) {
  db.tables[table] = [...(db.tables[table] ?? []), ...rows];
}

/** Настройки магазина (app_settings) парами ключ — значение. */
export function addSettings(db: StubDb, now: string, pairs: [string, string][]) {
  add(
    db,
    "app_settings",
    pairs.map(([key, value]) => shop({ key, value, updated_at: now })),
  );
}

/** Бот демо-магазина — чтобы раздел дописал свои модули и настройки. */
export function shopBot(db: StubDb): Row {
  const bot = (db.tables.bots ?? []).find((b) => b.id === F.SHOP_ID);
  if (!bot) throw new Error("seed: сначала seedShop");
  return bot;
}
