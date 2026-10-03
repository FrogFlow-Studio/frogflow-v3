import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import type { Tenant } from "@/core/tenant/types";
import { serverFailure } from "@/lib/server-failure";
import { alertChannelStatus, sendOperatorAlert } from "./health-alerts.server";
import {
  localDayHour,
  MORNING_HOUR,
  morningRows,
  morningText,
  pulseUnread,
  suspendedCount,
} from "./morning-brief";

/** Дата последней сводки (YYYY-MM-DD по поясу платформы) — отметка «один раз в день». */
export const MORNING_KEY = "operator_morning_brief";

export type MorningOutcome =
  "notDue" | "already" | "notConfigured" | "nobody" | "raced" | "failed" | "unknown" | "sent";

/**
 * Занять сегодняшнюю сводку условной записью: выигрывает один прогон, у
 * проигравшего ничего не уходит. Условие — на маленькое поле (дата).
 */
async function claim(
  day: string,
): Promise<{ status: "won" | "already" | "raced"; prev: string | null }> {
  const db = serviceDb();
  const { data, error } = await db
    .from("operator_settings")
    .select("value")
    .eq("key", MORNING_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`[morning] отметка не прочитана: ${error.message}`);
  const prev = data?.value ?? null;
  if (prev === day) return { status: "already", prev };
  if (!data) {
    const ins = await db.from("operator_settings").insert({ key: MORNING_KEY, value: day });
    if (ins.error?.code === "23505") return { status: "raced", prev };
    if (ins.error) throw serverFailure(`[morning] отметка не записана: ${ins.error.message}`);
    return { status: "won", prev };
  }
  const q = db.from("operator_settings").update({ value: day }).eq("key", MORNING_KEY);
  const { data: rows, error: upErr } = await (
    data.value === null ? q.is("value", null) : q.eq("value", data.value)
  ).select("key");
  if (upErr) throw serverFailure(`[morning] отметка не записана: ${upErr.message}`);
  return { status: (rows ?? []).length > 0 ? "won" : "raced", prev };
}

/** Крон health (раз в 15 минут): после 8:00 по поясу платформы — одна сводка в день. */
export async function runMorningBrief(
  tenants: readonly Pick<Tenant, "id" | "settings" | "archived">[],
  now = new Date(),
): Promise<MorningOutcome> {
  const { APP_URL, APP_TIMEZONE } = env();
  const { day, hour } = localDayHour(now, APP_TIMEZONE);
  if (hour < MORNING_HOUR) return "notDue";
  // Канал не настроен — отметку не ставим: сводка уйдёт, когда он появится.
  if (!(await alertChannelStatus()).configured) return "notConfigured";

  // Сегодняшняя отметка уже стоит — тяжёлое чтение клиентов не нужно (тик каждые 15 минут).
  if ((await readMark()) === day) return "already";

  const { listClients } = await import("./operator.server");
  const ids = new Set(
    tenants.filter((t) => t.settings.served_by === "v2" && !t.archived).map((t) => t.id),
  );
  const v2 = (await listClients()).filter((c) => ids.has(c.id));
  const text = morningText(
    morningRows(v2),
    APP_URL.replace(/\/$/, ""),
    pulseUnread(v2),
    suspendedCount(v2),
  );

  const { status, prev } = await claim(day);
  if (status === "already") return "already";
  if (status !== "won") return "raced";
  if (!text) return "nobody";
  const r = await sendOperatorAlert(text);
  if (r.ok) return "sent";
  if (r.reason === "failed" && r.maybeSent) {
    // Обрыв или тайм-аут: сообщение могло дойти — отметку оставляем, повтор продублировал бы сводку.
    console.warn("[morning] отправка неясна, отметка остаётся:", r.error);
    return "unknown";
  }
  // Telegram явно отказал — отметку возвращаем, следующий прогон повторит.
  await restore(day, prev);
  return "failed";
}

async function readMark(): Promise<string | null> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", MORNING_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`[morning] отметка не прочитана: ${error.message}`);
  return data?.value ?? null;
}

async function restore(day: string, prev: string | null): Promise<void> {
  const { error } = await serviceDb()
    .from("operator_settings")
    .update({ value: prev })
    .eq("key", MORNING_KEY)
    .eq("value", day);
  if (error) console.warn("[morning] отметка не возвращена:", error.message);
}
