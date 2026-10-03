/**
 * Дымовой прогон собранного сервера: поднять `.output` на подставной базе
 * (tests/e2e/pg-stub.ts) и пройти основные адреса. Ловит то, чего не видят
 * тесты на исходниках: сервер не стартует, маршрут пропал из сборки, вебхук
 * или крон отвечает 200 без секрета.
 *
 *   NITRO_PRESET=node-server npx vite build && npm run smoke
 *
 * Ключей живой базы здесь нет и быть не должно: сервер видит только подставную.
 * У каждого запроса свой тайм-аут; вебхуки и кроны без секрета не должны
 * оставлять следов в базе и сообщений в каналах.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { SHOP_ID, SHOP_SLUG } from "../tests/e2e/fixtures/shop.ts";
import { SECRETS_KEY, WEBHOOK_SECRET } from "../tests/e2e/fixtures/platform.ts";
import { ZERNIO_WEBHOOK_SECRET } from "../tests/e2e/fixtures/instagram.ts";
import { startPgStub, type StubDb } from "../tests/e2e/pg-stub.ts";
import { seedDb } from "../tests/e2e/seed.ts";

const APP_PORT = 3110;
const STUB_PORT = 54339;
const APP = `http://127.0.0.1:${APP_PORT}`;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const REQUEST_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 30_000;

export interface Check {
  name: string;
  method?: "GET" | "POST";
  path: string;
  body?: string;
  /** Допустимые статусы после перехода по редиректам. */
  status: number[];
  /** Окончательный адрес должен содержать это (вход в панель). */
  finalUrlIncludes?: string;
  /** Текст в теле ответа. */
  bodyIncludes?: string;
  /** Вебхук или крон без секрета: в базе и каналах ничего не меняется. */
  noWrites?: boolean;
}

export const CHECKS: Check[] = [
  { name: "главная", path: "/", status: [200], bodyIncludes: "FrogFlow" },
  { name: "лендинг школ", path: "/for/courses", status: [200] },
  { name: "статья блога", path: "/blog/telegram-sales-bot", status: [200] },
  { name: "витрина демо", path: `/s/${SHOP_SLUG}`, status: [200] },
  { name: "sitemap", path: "/sitemap.xml", status: [200], bodyIncludes: "<?xml" },
  { name: "robots", path: "/robots.txt", status: [200], bodyIncludes: "Sitemap" },
  {
    name: "health",
    path: "/api/health",
    status: [200],
    bodyIncludes: '"ok":true',
  },
  {
    name: "оператор → вход",
    path: "/operator",
    status: [200],
    finalUrlIncludes: "/operator/login",
  },
  { name: "админка → вход", path: "/admin", status: [200], finalUrlIncludes: "/admin/login" },
  {
    name: "вебхук Telegram без секрета",
    method: "POST",
    path: `/api/telegram/${SHOP_ID}`,
    body: "{}",
    status: [403],
    noWrites: true,
  },
  {
    name: "вебхук Zernio без подписи",
    method: "POST",
    path: "/api/zernio/webhook",
    body: "{}",
    status: [401],
    noWrites: true,
  },
  {
    name: "вебхук ApiPay без подписи",
    method: "POST",
    path: "/api/apipay/webhook",
    body: "{}",
    status: [401],
    noWrites: true,
  },
  {
    name: "Robokassa result без подписи",
    method: "POST",
    path: `/api/robokassa/${SHOP_ID}/result`,
    body: "",
    status: [400, 401, 403],
    noWrites: true,
  },
  { name: "крон без секрета", path: "/api/cron/reminders", status: [401], noWrites: true },
  { name: "публичный API без ключа", path: "/api/v1/orders", status: [401], noWrites: true },
];

/** Отпечаток записей подставной базы и каналов: до и после запроса он обязан совпасть. */
export function fingerprint(db: StubDb): string {
  const counts = Object.entries(db.tables)
    .map(([t, rows]) => `${t}:${rows.length}:${JSON.stringify(rows).length}`)
    .sort();
  return JSON.stringify({ counts, tg: db.telegram.length, zernio: db.zernio.length });
}

export interface Outcome {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runCheck(check: Check, db: StubDb, base = APP): Promise<Outcome> {
  const before = fingerprint(db);
  try {
    const res = await fetch(base + check.path, {
      method: check.method ?? "GET",
      body: check.body,
      headers: check.body !== undefined ? { "content-type": "application/json" } : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    const problems: string[] = [];
    if (!check.status.includes(res.status)) problems.push(`статус ${res.status}`);
    if (check.finalUrlIncludes && !res.url.includes(check.finalUrlIncludes))
      problems.push(`адрес ${res.url}`);
    if (check.bodyIncludes && !text.includes(check.bodyIncludes))
      problems.push(`в ответе нет «${check.bodyIncludes}»`);
    if (check.noWrites && fingerprint(db) !== before)
      problems.push("запрос изменил базу или канал");
    return { name: check.name, ok: problems.length === 0, detail: problems.join("; ") };
  } catch (e) {
    return { name: check.name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function waitHealthy(): Promise<boolean> {
  const until = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (res.status === 200) return true;
    } catch {
      // сервер ещё поднимается
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main(): Promise<number> {
  if (!existsSync(".output/server/index.mjs")) {
    console.error("smoke: нет .output — сначала `NITRO_PRESET=node-server npx vite build`");
    return 1;
  }
  const db = seedDb();
  const closeStub = await startPgStub(STUB_PORT, db);
  const app = spawn(process.execPath, [".output/server/index.mjs"], {
    stdio: "inherit",
    env: {
      HOST: "127.0.0.1",
      PORT: String(APP_PORT),
      APP_URL: APP,
      SUPABASE_URL: STUB,
      TELEGRAM_API_BASE: STUB,
      ZERNIO_BASE_URL: `${STUB}/zernio/v1`,
      ZERNIO_API_KEY: "smoke-zernio-key",
      ZERNIO_WEBHOOK_SECRET,
      APIPAY_WEBHOOK_SECRET: "smoke-apipay-secret-smoke-apipay-secret",
      SUPABASE_PUBLISHABLE_KEY: "smoke",
      SUPABASE_SERVICE_ROLE_KEY: "smoke",
      SUPABASE_JWT_SECRET: "smoke-jwt-secret-smoke-jwt-secret-0",
      SECRETS_KEY,
      SESSION_SECRET: "smoke-session-secret-smoke-session-secret",
      WEBHOOK_SECRET,
      CRON_SECRET: "smoke-cron-secret-0000",
    },
  });
  const stop = () => {
    app.kill("SIGTERM");
    void closeStub();
  };
  try {
    if (!(await waitHealthy())) {
      console.error(`smoke: сервер не отвечает на /api/health за ${START_TIMEOUT_MS / 1000} с`);
      return 1;
    }
    let failed = 0;
    for (const check of CHECKS) {
      const r = await runCheck(check, db);
      console.log(`${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
      if (!r.ok) failed += 1;
    }
    console.log(
      failed
        ? `\nsmoke: упало ${failed} из ${CHECKS.length}`
        : `\nsmoke: ${CHECKS.length} из ${CHECKS.length} зелёные`,
    );
    return failed ? 1 : 0;
  } finally {
    stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
