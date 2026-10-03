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
  platformAlertText,
  platformSummaryText,
  stepHealthAlerts,
  type AlertEvent,
  type AlertStates,
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
  /** Состояние сбоев платформы: кроны, вебхук Zernio, аккаунты (health-alerts.ts), JSON. */
  platformState: "operator_platform_alerts",
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
  const { data, error: readErr } = await db
    .from("operator_settings")
    .select("key")
    .eq("key", key)
    .maybeSingle();
  if (readErr) throw serverFailure(`[health] настройка не прочитана: ${readErr.message}`);
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
  /** maybeSent — запрос мог дойти (обрыв, тайм-аут): повторять нельзя. Без него — Telegram явно отказал. */
  | { ok: false; reason: "failed"; error: string; maybeSent?: true };

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
    return {
      ok: false,
      reason: "failed",
      error: e instanceof Error ? e.message : String(e),
      maybeSent: true,
    };
  }
}

/** Кнопка «Проверить»: пробное сообщение и понятная причина, если не дошло. */
export async function testAlertChannel(): Promise<{ ok: boolean; message: string }> {
  const r = await sendOperatorAlert(
    "✅ Проверка: уведомления FrogFlow о сбоях ботов клиентов и платформы будут приходить сюда.",
  );
  if (r.ok) return { ok: true, message: "Пробное сообщение отправлено." };
  if (r.reason === "not_configured")
    return { ok: false, message: "Уведомления не настроены: нужны токен бота и chat id." };
  const hint = /chat not found|bot was blocked|forbidden/i.test(r.error)
    ? " Откройте бота в Telegram и нажмите «Старт», затем проверьте chat id."
    : "";
  return { ok: false, message: `Telegram не доставил сообщение: ${r.error}.${hint}` };
}

/**
 * Номер версии в начале строки состояния: условная запись сравнивает только
 * его (like по префиксу), а не всё значение — при массовом сбое состояние
 * вырастает, и сравнение целиком в адресе запроса упёрлось бы в 431.
 */
const REV = "@rev";
const LEGACY_EQ_MAX = 2000;

type StateRow = { exists: boolean; raw: string | null; rev: number | null };

function revOf(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    const n = Number(v?.[REV]);
    return typeof v?.[REV] === "string" && Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/** Состояние с версией первым полем: `{"@rev":"7",…}`. */
export function stateWithRev(states: AlertStates, rev: number): string {
  return JSON.stringify({ [REV]: String(rev), ...states });
}

/** Строка состояния сбоев: есть ли она, её значение и версия — для условной записи. */
async function readState(key: string): Promise<StateRow> {
  const { data, error } = await serviceDb()
    .from("operator_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`operator_settings: ${error.message}`);
  const raw = data?.value ?? null;
  return { exists: Boolean(data), raw, rev: revOf(raw) };
}

/**
 * Записать состояние, только если его не поменял другой прогон с момента
 * чтения: сравнивается версия (или вставка, если строки не было). Строка
 * старого вида без версии сравнивается целиком, пока она короткая; длинная
 * переписывается без условия один раз — дальше у неё есть версия.
 * false — опередили, этот прогон ничего не шлёт.
 */
async function casState(
  key: string,
  prev: StateRow,
  states: AlertStates,
): Promise<StateRow | null> {
  const db = serviceDb();
  const rev = (prev.rev ?? 0) + 1;
  const value = stateWithRev(states, rev);
  const next = { exists: true, raw: value, rev };
  if (!prev.exists) {
    const { error } = await db.from("operator_settings").insert({ key, value });
    if (error?.code === "23505") return null;
    if (error) throw new Error(`operator_settings: ${error.message}`);
    return next;
  }
  const q = db.from("operator_settings").update({ value }).eq("key", key);
  const cond =
    prev.rev !== null
      ? q.like("value", `{"${REV}":"${prev.rev}"%`)
      : prev.raw === null
        ? q.is("value", null)
        : prev.raw.length <= LEGACY_EQ_MAX
          ? q.eq("value", prev.raw)
          : q;
  const { data, error } = await cond.select("key");
  if (error) throw new Error(`operator_settings: ${error.message}`);
  return (data ?? []).length > 0 ? next : null;
}

type AlertSummary = {
  down: number;
  up: number;
  sent: number;
  notConfigured: boolean;
  skipped?: true;
};

type Render = {
  one: (e: AlertEvent) => string;
  summary: (events: AlertEvent[]) => string;
};

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
): Promise<AlertSummary> {
  const { APP_URL, APP_TIMEZONE } = env();
  const base = APP_URL.replace(/\/$/, "");
  return runAlerts(ALERT_KEYS.state, probes, now, {
    one: (e) =>
      alertText(e, {
        name: names.get(e.botId) ?? e.botId,
        panelUrl: `${base}/operator/clients/${e.botId}`,
        timeZone: APP_TIMEZONE,
      }),
    summary: (events) => alertSummaryText(events, { names, panelUrl: `${base}/operator/clients` }),
  });
}

/**
 * То же для платформы: кроны, вебхук Zernio v2, отключившиеся аккаунты
 * Instagram/WhatsApp (probes — из platform-alerts.server). Своё состояние:
 * ключ, которого нет в прогоне, забывается, поэтому у ботов и у платформы
 * состояния раздельные.
 */
export async function processPlatformAlerts(
  probes: HealthProbe[],
  labels: Map<string, string>,
  now = new Date().toISOString(),
): Promise<AlertSummary> {
  const { APP_URL, APP_TIMEZONE } = env();
  const base = APP_URL.replace(/\/$/, "");
  return runAlerts(ALERT_KEYS.platformState, probes, now, {
    one: (e) => platformAlertText(e, { labels, base, timeZone: APP_TIMEZONE }),
    summary: (events) => platformSummaryText(events, { labels, base }),
  });
}

async function runAlerts(
  stateKey: string,
  probes: HealthProbe[],
  now: string,
  render: Render,
): Promise<AlertSummary> {
  const cur = await readState(stateKey);
  const prev = parseAlertStates(cur.raw);
  const { next, events } = stepHealthAlerts(prev, probes, now);
  const count = (k: AlertEvent["kind"]) => events.filter((e) => e.kind === k).length;
  const summary: AlertSummary = {
    down: count("down"),
    up: count("up"),
    sent: 0,
    notConfigured: false,
  };
  const configured = events.length > 0 && (await alertChannelStatus()).configured;
  // Канал не настроен — событий не отмечаем: сбой сообщится, когда канал появится.
  if (configured) for (const e of events) if (e.kind === "down") next[e.botId]!.notified = true;
  let row: StateRow = cur;
  if (JSON.stringify(next) !== JSON.stringify(prev)) {
    const claimed = await casState(stateKey, cur, next);
    if (!claimed) return { ...summary, skipped: true };
    row = claimed;
  }
  if (!events.length) return summary;
  if (!configured) return { ...summary, notConfigured: true };

  const failed: AlertEvent[] = [];
  if (events.length >= SUMMARY_FROM) {
    const r = await sendOperatorAlert(render.summary(events));
    if (r.ok) summary.sent = 1;
    else failed.push(...events);
  } else
    for (const e of events) {
      const r = await sendOperatorAlert(render.one(e));
      if (r.ok) summary.sent++;
      else failed.push(e);
    }
  if (failed.length) {
    for (const e of failed) {
      if (e.kind === "down") next[e.botId]!.notified = false;
      // «Снова отвечает» не ушло — сбой остаётся сообщённым, повтор на следующей удачной проверке.
      else next[e.botId] = { ...prev[e.botId]!, oks: RECOVER_THRESHOLD - 1 };
    }
    await casState(stateKey, row, next);
  }
  return summary;
}
