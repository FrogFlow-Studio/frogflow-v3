import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { UserError } from "@/core/i18n/user-error";
import { reportError } from "@/lib/errors";
import { serverFailure } from "@/lib/server-failure";

/**
 * app_settings — KV клиента, PK (bot_id, key). Те же ключи, что в v1.
 *
 * Мягкое чтение: при сбое базы отдаёт «пусто» (null), как будто настройки
 * нет. Годится там, где пусто безопасно — тексты, подсказки, необязательные
 * возможности. Деньги, чеки и лимиты читают getSettingStrict/getSettingsStrict.
 */
export async function getSetting(ctx: TenantContext, key: string): Promise<string | null> {
  const { data } = await ctx.db.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

/** Строгое чтение: «не удалось прочитать» — сбой, а не «настройки нет». */
export async function getSettingStrict(ctx: TenantContext, key: string): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw serverFailure(`Настройка ${key}: ${error.message}`);
  return data?.value ?? null;
}

/** Мягкое чтение нескольких ключей (см. getSetting). */
export async function getSettings(
  ctx: TenantContext,
  keys: readonly string[],
): Promise<Record<string, string>> {
  const { data } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .in("key", [...keys]);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.value != null) out[row.key] = row.value;
  return out;
}

/** Строгое чтение нескольких ключей: сбой базы не превращается в пустой набор. */
export async function getSettingsStrict(
  ctx: TenantContext,
  keys: readonly string[],
): Promise<Record<string, string>> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .in("key", [...keys]);
  if (error) throw serverFailure(`Настройки ${keys.join(", ")}: ${error.message}`);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.value != null) out[row.key] = row.value;
  return out;
}

/**
 * Записать настройку из админки. Сбой базы — не «сохранено»: отчёт в Sentry
 * и честная ошибка продавцу на его языке.
 */
export async function setSetting(ctx: TenantContext, key: string, value: string): Promise<void> {
  const failure = await writeSetting(ctx, key, value);
  if (!failure) return;
  await reportError(new Error(`app_settings ${key}: ${failure}`), {
    where: "settings.save",
    botId: ctx.tenant.id,
    extra: { key },
  });
  throw new UserError(
    "err.settings.saveFailed",
    "Настройка не сохранилась. Попробуйте ещё раз; если повторится — напишите в поддержку.",
  );
}

/**
 * Служебная запись бота и кронов (счётчики расхода, последняя ошибка):
 * сбой уходит в Sentry, а ответ покупателю не срывается. true — записано.
 */
export async function trySetSetting(
  ctx: TenantContext,
  key: string,
  value: string,
): Promise<boolean> {
  const failure = await writeSetting(ctx, key, value);
  if (failure)
    await reportError(new Error(`app_settings ${key}: ${failure}`), {
      where: "settings.write",
      botId: ctx.tenant.id,
      extra: { key },
    });
  return !failure;
}

/**
 * Не upsert: ON CONFLICT требует имени уникального ограничения, а PK
 * app_settings менялся в истории; update-then-insert работает при любом.
 * Возвращает текст сбоя или null.
 */
async function writeSetting(ctx: TenantContext, key: string, value: string) {
  const found = await ctx.db.from("app_settings").select("key").eq("key", key).maybeSingle();
  if (found.error) return found.error.message;
  if (found.data) return updateSetting(ctx, key, value);
  const { error } = await ctx.db
    .from("app_settings")
    .insert({ bot_id: ctx.tenant.id, key, value, updated_at: new Date().toISOString() });
  if (!error) return null;
  // Ключ вставили параллельно между чтением и вставкой — дописываем поверх.
  return error.code === "23505" ? updateSetting(ctx, key, value) : error.message;
}

async function updateSetting(ctx: TenantContext, key: string, value: string) {
  const { data, error } = await ctx.db
    .from("app_settings")
    // Дата записи — по ней страница настроек поднимает «изменено недавно».
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", key)
    .select("key");
  if (error) return error.message;
  // Без ошибки, но ни одной строки: права арендатора не пустили к записи.
  return data?.length ? null : "строка не обновилась";
}

/**
 * Атомарно изменить настройку: прочитать, вычислить новое значение и
 * записать, только если в базе всё ещё то, что прочитали (сравнение с
 * прежним значением в WHERE; строку, которой не было, — вставкой, повтор
 * ключа даёт 23505). Проиграл гонку — ждём случайную паузу, растущую с
 * каждым проигрышем (до 250 мс), и читаем заново, до `tries` раз. Без паузы
 * десятки одновременных запросов перечитывают строку разом и снова
 * сталкиваются: на живой базе 12 из 30 не успевали за 8 попыток. Так
 * параллельные запросы не проскакивают мимо дневного предела и не затирают
 * чужие прибавки к счётчику. `next` вернул null — ничего не пишем.
 *
 * "written" — записано, "skipped" — next отказался, "failed" — сбой базы
 * или гонка не выиграна за `tries` попыток (в Sentry).
 */
export async function updateSettingAtomic(
  ctx: TenantContext,
  key: string,
  next: (raw: string | null) => string | null,
  tries = ATOMIC_TRIES,
): Promise<"written" | "skipped" | "failed"> {
  for (let i = 0; i < tries; i++) {
    if (i > 0) await backoff(i);
    const found = await ctx.db.from("app_settings").select("value").eq("key", key).maybeSingle();
    if (found.error) return failed(ctx, key, found.error.message);
    const raw = found.data ? (found.data.value ?? null) : null;
    const value = next(raw);
    if (value == null) return "skipped";
    if (!found.data) {
      const { error } = await ctx.db
        .from("app_settings")
        .insert({ bot_id: ctx.tenant.id, key, value, updated_at: new Date().toISOString() });
      if (!error) return "written";
      if (error.code !== "23505") return failed(ctx, key, error.message);
      continue;
    }
    const q = ctx.db
      .from("app_settings")
      // Дата записи — по ней ночная уборка находит старые счётчики (core/retention).
      .update({ value, updated_at: new Date().toISOString() })
      .eq("key", key);
    const { data, error } = await (raw == null ? q.is("value", null) : q.eq("value", raw)).select(
      "key",
    );
    if (error) return failed(ctx, key, error.message);
    if (data?.length) return "written";
  }
  return failed(ctx, key, `не удалось записать за ${tries} попыток: параллельные изменения`);
}

/**
 * Как updateSettingAtomic, но для больших значений (журналы, ответы учеников):
 * условие записи — метка `updated_at`, а не всё значение. Значение в WHERE
 * уходит в адрес запроса, и после ~8 КБ PostgREST отвечает 431 — запись
 * молча перестала бы работать. Метка меняется при каждой записи (не меньше
 * чем на 1 мс), поэтому проигравший гонку не затрёт чужое. Годится только
 * для ключей, которые пишет одна v2 и всегда этой функцией.
 */
export async function updateSettingStamped(
  ctx: TenantContext,
  key: string,
  next: (raw: string | null) => string | null,
  tries = ATOMIC_TRIES,
): Promise<"written" | "skipped" | "failed"> {
  for (let i = 0; i < tries; i++) {
    if (i > 0) await backoff(i);
    const found = await ctx.db
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", key)
      .maybeSingle();
    if (found.error) return failed(ctx, key, found.error.message);
    const raw = found.data ? (found.data.value ?? null) : null;
    const value = next(raw);
    if (value == null) return "skipped";
    const prev = found.data?.updated_at ?? null;
    const stamp = new Date(
      Math.max(Date.now(), prev ? Date.parse(prev) + 1 : 0) || Date.now(),
    ).toISOString();
    if (!found.data) {
      const { error } = await ctx.db
        .from("app_settings")
        .insert({ bot_id: ctx.tenant.id, key, value, updated_at: stamp });
      if (!error) return "written";
      if (error.code !== "23505") return failed(ctx, key, error.message);
      continue;
    }
    const q = ctx.db.from("app_settings").update({ value, updated_at: stamp }).eq("key", key);
    const { data, error } = await (
      prev == null ? q.is("updated_at", null) : q.eq("updated_at", prev)
    ).select("key");
    if (error) return failed(ctx, key, error.message);
    if (data?.length) return "written";
  }
  return failed(ctx, key, `не удалось записать за ${tries} попыток: параллельные изменения`);
}

/** Попыток хватает на сотню одновременных запросов: каждый круг кто-то выигрывает. */
export const ATOMIC_TRIES = 60;

/** Случайная пауза перед повтором: 0…min(250, 10·2^n) мс, чтобы проигравшие разошлись. */
function backoff(attempt: number): Promise<void> {
  const cap = Math.min(250, 10 * 2 ** attempt);
  return new Promise((r) => setTimeout(r, Math.random() * cap));
}

async function failed(ctx: TenantContext, key: string, message: string) {
  await reportError(new Error(`app_settings ${key}: ${message}`), {
    where: "settings.atomic",
    botId: ctx.tenant.id,
    extra: { key },
  });
  return "failed" as const;
}

/** Список Telegram-id из строки «1, 2; 3» без дублей. */
export function parseIdList(raw: string | null | undefined): string[] {
  return Array.from(
    new Set(
      (raw ?? "")
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/** Ключи из `known`, которые продавец менял за последние `days` дней (по `updated_at`). */
export async function recentSettingKeys(
  ctx: TenantContext,
  known: readonly string[],
  days = 7,
  now = new Date(),
): Promise<string[]> {
  const since = new Date(now.getTime() - days * 86400_000).toISOString();
  const rows = await pageAll<{ key: string }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key")
        .gte("updated_at", since)
        .order("key")
        .range(from, to),
    "Настройки: недавно изменённые",
  );
  const set = new Set(known);
  return rows.map((r) => r.key).filter((k) => set.has(k));
}
