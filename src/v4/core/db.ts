import { serverFailure } from "@/lib/server-failure";

/**
 * Доступ ядра v4 к базе. Вся логика денег — в SQL-функциях схемы v4
 * (migrations/v4/002-money.sql): блокировки, уникальные ключи и условные
 * записи работают в базе, а не в коде. Код только вызывает функцию.
 *
 * Две реализации: PostgREST (`postgrestV4Db`, прод, роль арендатора или
 * сервисная) и PGlite в тестах (`src/v4/test/pg.ts`), поэтому тесты гоняют
 * ту же логику, что и прод.
 */
export type V4Db = {
  /** Вызвать функцию v4.<fn> с именованными аргументами; всегда массив строк. */
  call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
};

/** Отказы, которые SQL-функции v4 поднимают как `v4:<код>`. Ожидаемые, не сбой. */
export const V4_REFUSALS = [
  "shop_not_found",
  "empty_order",
  "product_unavailable",
  "points_negative",
  "points_no_rate",
  "points_exceed_balance",
  "points_exceed_limit",
  "order_not_found",
  "amount_not_positive",
  "reason_required",
  "refund_exceeds_paid",
  "receipt_not_found",
  "bad_close_status",
  "append_only",
  "unknown_case_kind",
  "no_work_hours",
  "bad_status",
  "choose_variant",
  "access_not_found",
  "foreign_bot",
] as const;
export type V4Refusal = (typeof V4_REFUSALS)[number];

export class V4RefusalError extends Error {
  override name = "V4RefusalError";
  constructor(readonly code: V4Refusal) {
    super(`v4:${code}`);
  }
}

export type V4Result<T> = { ok: true; value: T } | { ok: false; code: V4Refusal };

/** Разбор ошибки базы: `v4:<код>` → отказ, остальное → сбой (serverFailure). */
export function v4Error(fn: string, message: string): Error {
  const m = /v4:([a-z_]+)/.exec(message);
  const code = m?.[1] as V4Refusal | undefined;
  if (code && (V4_REFUSALS as readonly string[]).includes(code)) return new V4RefusalError(code);
  return serverFailure(`v4.${fn} не выполнилась: ${message}`);
}

/** Вызов с отказом в результате, а не исключением. Сбой базы по-прежнему бросается. */
export async function attempt<T>(run: () => Promise<T>): Promise<V4Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    if (e instanceof V4RefusalError) return { ok: false, code: e.code };
    throw e;
  }
}

type RpcClient = {
  schema(name: "v4"): {
    rpc(
      fn: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
};

/** PostgREST: нужна схема v4 в Supabase → Settings → API → Exposed schemas. */
export function postgrestV4Db(client: RpcClient): V4Db {
  return {
    async call(fn, args) {
      const { data, error } = await client.schema("v4").rpc(fn, args);
      if (error) throw v4Error(fn, error.message);
      if (data == null) return [];
      if (Array.isArray(data)) return data as Record<string, unknown>[];
      if (typeof data === "object") return [data as Record<string, unknown>];
      return [{ [fn]: data }];
    },
  };
}
