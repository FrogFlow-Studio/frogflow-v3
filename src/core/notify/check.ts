import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateSettingAtomic } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import type { Locale } from "@/core/i18n/locale";
import { telegramFailureCode, type TelegramFailureCode } from "./deliver";
import type { NotifyPrefs } from "./prefs";

/**
 * «Проверить уведомления»: тестовое сообщение каждому получателю по каждому
 * включённому каналу и итог по каждому понятным кодом (панель переводит его на
 * язык продавца). Ядро каналов не знает: отправки приходят снаружи.
 */
export type CheckCode =
  | "ok"
  | TelegramFailureCode
  | "no_recipients"
  | "no_bot"
  | "mail_off"
  | "mail_no_address"
  | "mail_failed"
  | "push_none";

export type CheckLine = {
  channel: "telegram" | "email" | "push";
  /** Кому: id чата, адрес почты или «устройства»; пусто, если адресата нет. */
  target: string;
  ok: boolean;
  code: CheckCode;
  /** Текст отказа как есть — для поддержки (только если код `other`). */
  detail?: string;
};

export type CheckDeps = {
  /** Есть ли у магазина бот Telegram. */
  hasBot: boolean;
  recipients: readonly string[];
  sendTelegram: (chatId: string) => Promise<{ ok?: boolean; description?: string }>;
  mailConfigured: boolean;
  sendMail: (to: string) => Promise<{ ok: boolean; error?: string }>;
  /** Push настроен на платформе (VAPID). */
  pushConfigured: boolean;
  /** Сколько устройств получили тестовый push. */
  sendPush: () => Promise<number>;
};

const TITLES: Record<Locale, string> = {
  ru: "✅ Проверка уведомлений FrogFlow: это сообщение дошло. Заказы и вопросы покупателей будут приходить сюда.",
  kk: "✅ FrogFlow хабарландыруларын тексеру: бұл хабарлама жетті. Тапсырыстар мен сатып алушылардың сұрақтары осында келеді.",
  en: "✅ FrogFlow notification check: this message arrived. Orders and buyer questions will come here.",
  uz: "✅ FrogFlow bildirishnomalarini tekshirish: bu xabar yetib keldi. Buyurtmalar va xaridorlar savollari shu yerga keladi.",
};

export const checkText = (locale: Locale) => TITLES[locale] ?? TITLES.ru;

/** Каналы, которые продавец включил: Telegram — если есть бот; почта — если выбрана хоть для одного вида; push — если платформа его умеет. */
export async function runNotifyCheck(prefs: NotifyPrefs, deps: CheckDeps): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];

  if (!deps.hasBot) lines.push({ channel: "telegram", target: "", ok: false, code: "no_bot" });
  else if (!deps.recipients.length)
    lines.push({ channel: "telegram", target: "", ok: false, code: "no_recipients" });
  else
    for (const id of deps.recipients) {
      try {
        const r = await deps.sendTelegram(id);
        if (r.ok) lines.push({ channel: "telegram", target: id, ok: true, code: "ok" });
        else {
          const code = telegramFailureCode(r.description);
          lines.push({
            channel: "telegram",
            target: id,
            ok: false,
            code,
            ...(code === "other" ? { detail: r.description } : {}),
          });
        }
      } catch (e) {
        lines.push({
          channel: "telegram",
          target: id,
          ok: false,
          code: telegramFailureCode(e instanceof Error ? e.message : String(e)),
        });
      }
    }

  const emailChosen = Object.values(prefs.kinds).some((c) => c.email);
  if (emailChosen) {
    if (!deps.mailConfigured)
      lines.push({ channel: "email", target: prefs.email, ok: false, code: "mail_off" });
    else if (!prefs.email)
      lines.push({ channel: "email", target: "", ok: false, code: "mail_no_address" });
    else {
      const r = await deps.sendMail(prefs.email).catch((e) => ({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      lines.push({
        channel: "email",
        target: prefs.email,
        ok: r.ok,
        code: r.ok ? "ok" : "mail_failed",
        ...(r.ok ? {} : { detail: r.error }),
      });
    }
  }

  // Push — необязательный канал: платформа его не умеет — строки нет, а не «ошибка».
  if (deps.pushConfigured) {
    const n = await deps.sendPush().catch(() => 0);
    lines.push({
      channel: "push",
      target: n ? String(n) : "",
      ok: n > 0,
      code: n > 0 ? "ok" : "push_none",
    });
  }
  return lines;
}

export const CHECK_MIN_GAP_MS = 20_000;
const CHECK_KEY = "notify_check_at";

/**
 * Занять «Проверить уведомления» условной записью в базе: проверка шлёт настоящие
 * сообщения, поэтому предел «не чаще раза в 20 с на магазин» общий для всех
 * экземпляров сервера, а не живёт в памяти одного. true — проверку можно запускать.
 */
export async function claimNotifyCheck(ctx: TenantContext, now = Date.now()): Promise<boolean> {
  const r = await updateSettingAtomic(ctx, CHECK_KEY, (raw) => {
    const last = Number(raw ?? 0);
    return now - last < CHECK_MIN_GAP_MS && now >= last ? null : String(now);
  });
  if (r === "failed") throw serverFailure("Проверка уведомлений: не удалось занять запуск");
  return r === "written";
}
