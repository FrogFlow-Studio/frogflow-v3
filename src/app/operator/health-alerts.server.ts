import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { decryptSecret, encryptSecret } from "@/core/secrets/vault";
import { telegramApi } from "@/channels/telegram/api";
import { serverFailure } from "@/lib/server-failure";
import {
  RECOVER_THRESHOLD,
  SUMMARY_FROM,
  alertSummaryText,
  alertText,
  parseAlertStates,
  stepHealthAlerts,
  type AlertEvent,
  type HealthProbe,
} from "./health-alerts";

/**
 * Канал уведомлений оператору: отдельный бот от BotFather и chat id
 * оператора в operator_settings. Токен зашифрован SECRETS_KEY, как токены
 * клиентов. Пока канал не настроен, уведомления тихо не отправляются.
 */
export const ALERT_KEYS = {
  token: "operator_alert_bot_token",
  chatId: "operator_alert_chat_id",
  username: "operator_alert_bot_username",
  /** Состояние сбоев по ботам (health-alerts.ts), JSON. */
  state: "operator_health_alerts",
} as const;

const TOKEN_RE = /^\d{5,}:[\w-]{30,}$/;
const CHAT_ID_RE = /^-?\d{3,20}$/;

async function readKeys(keys: string[]): Promise<Record<string, string>> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("key, value")
    .in("key", keys);
  if (error) throw new Error(`operator_settings: ${error.message}`);
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.value != null) out[r.key] = r.value;
  return out;
}

async function writeKey(key: string, value: string): Promise<void> {
  const db = serviceDb();
  const { data } = await db.from("operator_settings").select("key").eq("key", key).maybeSingle();
  const { error } = data
    ? await db.from("operator_settings").update({ value }).eq("key", key)
    : await db.from("operator_settings").insert({ key, value });
  if (error) throw serverFailure(`Не удалось сохранить настройку: ${error.message}`);
}

export type AlertChannelStatus = {
  configured: boolean;
  chatId: string | null;
  botUsername: string | null;
};

export async function alertChannelStatus(): Promise<AlertChannelStatus> {
  const s = await readKeys([ALERT_KEYS.token, ALERT_KEYS.chatId, ALERT_KEYS.username]);
  return {
    configured: Boolean(s[ALERT_KEYS.token] && s[ALERT_KEYS.chatId]),
    chatId: s[ALERT_KEYS.chatId] ?? null,
    botUsername: s[ALERT_KEYS.username] ?? null,
  };
}

const api = (token: string) => telegramApi(token, env().TELEGRAM_API_BASE);

/**
 * Сохранить канал. Пустой токен — оставить прежний (в панель он не
 * возвращается). Новый токен проверяется getMe до записи.
 */
export async function saveAlertChannel(input: { token: string; chatId: string }): Promise<void> {
  const token = input.token.trim();
  const chatId = input.chatId.trim();
  if (!CHAT_ID_RE.test(chatId))
    throw new Error("Chat id — это число, например 123456789 или -1001234567890.");
  if (token) {
    if (!TOKEN_RE.test(token))
      throw new Error("Токен не похож на токен BotFather: 123456789:AA… целиком.");
    const me = await api(token).call<{ username?: string }>("getMe");
    if (!me.ok) throw new Error(`Telegram не принял токен: ${me.description ?? "нет ответа"}.`);
    await writeKey(ALERT_KEYS.token, encryptSecret(token, env().SECRETS_KEY));
    await writeKey(ALERT_KEYS.username, me.result?.username ?? "");
  } else if (!(await readKeys([ALERT_KEYS.token]))[ALERT_KEYS.token]) {
    throw new Error("Вставьте токен бота от BotFather.");
  }
  await writeKey(ALERT_KEYS.chatId, chatId);
}

/** Выключить уведомления: токен, chat id и имя бота удаляются. */
export async function clearAlertChannel(): Promise<void> {
  const { error } = await serviceDb()
    .from("operator_settings")
    .delete()
    .in("key", [ALERT_KEYS.token, ALERT_KEYS.chatId, ALERT_KEYS.username]);
  if (error) throw new Error(`operator_settings: ${error.message}`);
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "failed"; error: string };

/** Сообщение оператору. Канал не настроен — ничего не делаем и не шумим. */
export async function sendOperatorAlert(html: string): Promise<SendResult> {
  const s = await readKeys([ALERT_KEYS.token, ALERT_KEYS.chatId]);
  const enc = s[ALERT_KEYS.token];
  const chatId = s[ALERT_KEYS.chatId];
  if (!enc || !chatId) return { ok: false, reason: "not_configured" };
  try {
    const r = await api(decryptSecret(enc, env().SECRETS_KEY)).call("sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return r.ok ? { ok: true } : { ok: false, reason: "failed", error: r.description ?? "" };
  } catch (e) {
    return { ok: false, reason: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Кнопка «Проверить»: пробное сообщение и понятная причина, если не дошло. */
export async function testAlertChannel(): Promise<{ ok: boolean; message: string }> {
  const r = await sendOperatorAlert(
    "✅ Проверка: уведомления FrogFlow о сбоях ботов клиентов будут приходить сюда.",
  );
  if (r.ok) return { ok: true, message: "Пробное сообщение отправлено." };
  if (r.reason === "not_configured")
    return { ok: false, message: "Уведомления не настроены: нужны токен бота и chat id." };
  const hint = /chat not found|bot was blocked|forbidden/i.test(r.error)
    ? " Откройте бота в Telegram и нажмите «Старт», затем проверьте chat id."
    : "";
  return { ok: false, message: `Telegram не доставил сообщение: ${r.error}.${hint}` };
}

/** Строка состояния сбоев как есть: есть ли она и её значение — для условной записи. */
async function readState(): Promise<{ exists: boolean; raw: string | null }> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", ALERT_KEYS.state)
    .maybeSingle();
  if (error) throw new Error(`operator_settings: ${error.message}`);
  return { exists: Boolean(data), raw: data?.value ?? null };
}

/**
 * Записать состояние, только если его не поменял другой прогон с момента
 * чтения: сравнение со старым значением (или вставка, если строки не было).
 * false — опередили, этот прогон ничего не шлёт.
 */
async function casState(prev: { exists: boolean; raw: string | null }, value: string) {
  const db = serviceDb();
  if (!prev.exists) {
    const { error } = await db.from("operator_settings").insert({ key: ALERT_KEYS.state, value });
    if (error?.code === "23505") return false;
    if (error) throw new Error(`operator_settings: ${error.message}`);
    return true;
  }
  const q = db.from("operator_settings").update({ value }).eq("key", ALERT_KEYS.state);
  const { data, error } = await (
    prev.raw === null ? q.is("value", null) : q.eq("value", prev.raw)
  ).select("key");
  if (error) throw new Error(`operator_settings: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Прогон крона здоровья: переходы «сбой / восстановление» и сообщения
 * оператору. probes — снимки этого прогона (только клиенты v2 без архива).
 *
 * Два прогона одновременно (повтор крона, ручной запуск) не шлют одно и то
 * же дважды: прогон сначала условно записывает состояние с отметкой
 * «сообщено» и только потом отправляет; опередивший второй прогон молчит.
 * Не ушедшее сообщение возвращает отметку назад — повтор на следующем прогоне.
 */
export async function processHealthAlerts(
  probes: HealthProbe[],
  names: Map<string, string>,
  now = new Date().toISOString(),
): Promise<{
  down: number;
  up: number;
  sent: number;
  notConfigured: boolean;
  skipped?: true;
}> {
  const cur = await readState();
  const prev = parseAlertStates(cur.raw);
  const { next, events } = stepHealthAlerts(prev, probes, now);
  const count = (k: AlertEvent["kind"]) => events.filter((e) => e.kind === k).length;
  const summary = { down: count("down"), up: count("up"), sent: 0, notConfigured: false };
  const configured = events.length > 0 && (await alertChannelStatus()).configured;
  // Канал не настроен — событий не отмечаем: сбой сообщится, когда канал появится.
  if (configured) for (const e of events) if (e.kind === "down") next[e.botId]!.notified = true;
  const claimed = JSON.stringify(next);
  if (claimed !== (cur.raw ?? "{}") && !(await casState(cur, claimed)))
    return { ...summary, skipped: true };
  if (!events.length) return summary;
  if (!configured) return { ...summary, notConfigured: true };

  const { APP_URL, APP_TIMEZONE } = env();
  const base = APP_URL.replace(/\/$/, "");
  const failed: AlertEvent[] = [];
  if (events.length >= SUMMARY_FROM) {
    const r = await sendOperatorAlert(
      alertSummaryText(events, { names, panelUrl: `${base}/operator/clients` }),
    );
    if (r.ok) summary.sent = 1;
    else failed.push(...events);
  } else
    for (const e of events) {
      const r = await sendOperatorAlert(
        alertText(e, {
          name: names.get(e.botId) ?? e.botId,
          panelUrl: `${base}/operator/clients/${e.botId}`,
          timeZone: APP_TIMEZONE,
        }),
      );
      if (r.ok) summary.sent++;
      else failed.push(e);
    }
  if (failed.length) {
    for (const e of failed) {
      if (e.kind === "down") next[e.botId]!.notified = false;
      // «Снова отвечает» не ушло — сбой остаётся сообщённым, повтор на следующей удачной проверке.
      else next[e.botId] = { ...prev[e.botId]!, oks: RECOVER_THRESHOLD - 1 };
    }
    await casState({ exists: true, raw: claimed }, JSON.stringify(next));
  }
  return summary;
}
