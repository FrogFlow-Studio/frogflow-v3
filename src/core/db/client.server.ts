import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/core/db-types";
import { env } from "@/config/env";
import { mintTenantJwt, TENANT_JWT_TTL_SEC } from "@/core/tenant/jwt";

export type Db = SupabaseClient<Database>;

/**
 * Подключения к базе.
 *
 * Та же схема, что в v1: шлюзу Supabase в `apikey` уходит настоящий ключ
 * проекта, а роль PostgREST берёт из `Authorization`. Разница одна: ключ
 * арендатора не из переменной окружения на весь деплой, а подписанный на
 * лету под bot_id из запроса. Изоляцию обеспечивает Postgres (RLS из
 * MIGRATION-02), а не память программиста.
 *
 * `.storage` намеренно ходит под service_role: бакеты общие, роль
 * tenant_bot хранилище не резолвит. Пути в бакетах начинаются с bot_id, и
 * проверка принадлежности файла — обязанность кода, который его отдаёт.
 */
function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

export function fetchWith(apiKey: string, bearer: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    headers.set("apikey", apiKey);
    if (isNewSupabaseApiKey(bearer)) headers.delete("Authorization");
    else headers.set("Authorization", `Bearer ${bearer}`);
    // Свой тайм-аут на каждый запрос; вызывающий может оборвать раньше (init.signal).
    const timeout = AbortSignal.timeout(requestTimeoutMs(input));
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, headers, signal });
  };
}

/** Запросы к PostgREST быстрые; файлы в Storage дольше. Оба меньше бюджета функции (120 с). */
export const DB_TIMEOUT_MS = 25_000;
export const STORAGE_TIMEOUT_MS = 90_000;

function requestTimeoutMs(input: Parameters<typeof fetch>[0]): number {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.includes("/storage/v1/") ? STORAGE_TIMEOUT_MS : DB_TIMEOUT_MS;
}

function build(bearer: string): Db {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env();
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { fetch: fetchWith(SUPABASE_SERVICE_ROLE_KEY, bearer) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

let service: Db | undefined;

/**
 * service_role: видит всех арендаторов. Только для справочника арендаторов,
 * панели оператора, кронов, которые обходят всех клиентов, и хранилища.
 * В коде домена не используется — домен получает `ctx.db`.
 */
export function serviceDb(): Db {
  if (!service) service = build(env().SUPABASE_SERVICE_ROLE_KEY);
  return service;
}

type TenantEntry = { db: Db; expiresAt: number };
const tenantClients = new Map<string, TenantEntry>();
const REFRESH_MARGIN_SEC = 5 * 60;

/** Подключение под ролью tenant_bot с bot_id в claim'ах — видит только своё. */
export function tenantDb(botId: string): Db {
  const now = Math.floor(Date.now() / 1000);
  const cached = tenantClients.get(botId);
  if (cached && cached.expiresAt - REFRESH_MARGIN_SEC > now) return cached.db;
  const jwt = mintTenantJwt(botId, env().SUPABASE_JWT_SECRET, now);
  const entry = { db: build(jwt), expiresAt: now + TENANT_JWT_TTL_SEC };
  tenantClients.set(botId, entry);
  return entry.db;
}

/** Только для тестов. */
export function resetDbClients(): void {
  service = undefined;
  tenantClients.clear();
}
