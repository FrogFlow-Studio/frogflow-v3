import type { ChannelGuardEntry, ZernioAccountSnapshot } from "@/core/tenant/types";
import type { Locale } from "@/core/i18n/locale";

/**
 * Страж каналов Instagram/WhatsApp — чистая часть, без базы и сети. Канал
 * «лежит», если слетел токен аккаунта, отключён вебхук Zernio или подряд
 * не доходят сообщения. Каждый переход «работал → лежит» и «лежал → снова
 * работает» бывает один раз: сообщение шлёт тот, кто записал переход (условная
 * запись в guard.server).
 */
export type GuardPlatform = "instagram" | "whatsapp";
export type GuardEntry = ChannelGuardEntry;
export type GuardMap = Partial<Record<GuardPlatform, GuardEntry>>;
export type GuardProblem = GuardEntry["reason"];

/** Сбоев отправки подряд, после которых канал считается лежащим. */
export const FAIL_THRESHOLD = 3;
/** Сбои считаются подряд, пока между ними не больше этого. */
export const FAIL_WINDOW_MS = 30 * 60_000;

export const GUARD_PLATFORMS: readonly GuardPlatform[] = ["instagram", "whatsapp"];

/** Лежит ли канал по записи: «на подозрении» (сбоев меньше порога) — ещё нет. */
export function isDown(e: GuardEntry | undefined | null): boolean {
  if (!e) return false;
  return e.reason !== "failures" || (e.fails ?? 0) >= FAIL_THRESHOLD;
}

/** Серия сбоев кончилась: давно не было новых. */
export function failuresExpired(e: GuardEntry, now: number): boolean {
  const last = Date.parse(e.last_fail_at ?? e.since);
  return !Number.isFinite(last) || now - last > FAIL_WINDOW_MS;
}

/**
 * Что не так по снимку аккаунтов: слетел токен — это приоритетнее, чем
 * вебхук (он общий на платформу и касается каждого канала, где есть аккаунт).
 * `webhookOk` null — проверить не удалось: это не повод будить продавца.
 */
export function detectProblems(
  accounts: readonly ZernioAccountSnapshot[],
  webhookOk: boolean | null,
): Partial<Record<GuardPlatform, GuardProblem>> {
  const out: Partial<Record<GuardPlatform, GuardProblem>> = {};
  for (const p of GUARD_PLATFORMS) {
    const mine = accounts.filter((a) => a.platform === p);
    if (mine.length === 0) continue;
    if (mine.some((a) => a.expired)) out[p] = "token";
    else if (webhookOk === false) out[p] = "webhook";
  }
  return out;
}

export type Transition = {
  platform: GuardPlatform;
  /** down — канал упал (сообщение «отвалился»), up — ожил (сообщение «снова работает»), quiet — только запись. */
  kind: "down" | "up" | "quiet";
  from: GuardEntry | null;
  to: GuardEntry | null;
};

/** Переходы по текущим записям и тому, что видно сейчас. */
export function planTransitions(
  current: GuardMap,
  problems: Partial<Record<GuardPlatform, GuardProblem>>,
  now: number,
): Transition[] {
  const out: Transition[] = [];
  for (const platform of GUARD_PLATFORMS) {
    const cur = current[platform] ?? null;
    const prob = problems[platform];
    if (prob) {
      if (cur && cur.reason === prob) continue;
      if (cur && isDown(cur)) {
        // Лежал по другой причине: сообщение уже было, меняем только запись.
        out.push({ platform, kind: "quiet", from: cur, to: { since: cur.since, reason: prob } });
        continue;
      }
      out.push({
        platform,
        kind: "down",
        from: cur,
        to: { since: new Date(now).toISOString(), reason: prob },
      });
      continue;
    }
    if (!cur) continue;
    if (cur.reason === "failures") {
      if (!failuresExpired(cur, now)) continue;
      out.push({ platform, kind: isDown(cur) ? "up" : "quiet", from: cur, to: null });
      continue;
    }
    out.push({ platform, kind: "up", from: cur, to: null });
  }
  return out;
}

/**
 * Переходы по снимку аккаунтов магазина и вебхуку — с двумя поправками на «неизвестно»:
 * • вебхук не проверен (`null`) — запись о нём не снимаем и «снова работает» не пишем: «не
 *   проверили» не значит «починили»;
 * • канала в снимке больше нет (продавец отключил Instagram/WhatsApp) — запись убираем молча:
 *   сообщать, что отключённый канал «снова работает», нечего.
 */
export function planGuard(
  current: GuardMap,
  accounts: readonly ZernioAccountSnapshot[],
  webhookOk: boolean | null,
  now: number,
): Transition[] {
  const out: Transition[] = [];
  for (const t of planTransitions(current, detectProblems(accounts, webhookOk), now)) {
    if (t.kind === "up") {
      if (!accounts.some((a) => a.platform === t.platform)) {
        out.push({ ...t, kind: "quiet" });
        continue;
      }
      if (webhookOk === null && t.from?.reason === "webhook") continue;
    }
    out.push(t);
  }
  return out;
}

/** Ещё один сбой отправки: следующая запись и стал ли канал лежащим именно сейчас; null — менять нечего. */
export function registerFailure(
  cur: GuardEntry | null,
  now: number,
): { next: GuardEntry; becameDown: boolean } | null {
  if (cur && cur.reason !== "failures") return null; // уже лежит по более явной причине
  const at = new Date(now).toISOString();
  const continued = cur && !failuresExpired(cur, now);
  const fails = continued ? (cur.fails ?? 0) + 1 : 1;
  const since = continued ? cur.since : at;
  return {
    next: { since, reason: "failures", fails, last_fail_at: at },
    becameDown: fails === FAIL_THRESHOLD,
  };
}

const CHANNEL: Record<GuardPlatform, string> = { instagram: "Instagram", whatsapp: "WhatsApp" };

type Words = {
  downTitle: (ch: string, at: string) => string;
  downBody: Record<GuardProblem, string>;
  button: string;
  upTitle: (ch: string) => string;
  upBody: string;
};

const WORDS: Record<Locale, Words> = {
  ru: {
    downTitle: (ch, at) => `🔌 <b>${ch} отвалился с ${at}</b>`,
    downBody: {
      token: "Авторизация аккаунта слетела: покупатели не получают ответы бота.",
      webhook: "Связь платформы с каналом отключена: бот не видит сообщения покупателей.",
      failures: "Сообщения покупателям подряд не доходят: бот отвечает впустую.",
    },
    button: "Переподключить",
    upTitle: (ch) => `✅ <b>${ch} снова работает</b>`,
    upBody: "Бот снова видит сообщения и отвечает покупателям.",
  },
  kk: {
    downTitle: (ch, at) => `🔌 <b>${ch} ${at} бастап ажырап қалды</b>`,
    downBody: {
      token: "Аккаунт авторизациясы жарамсыз: сатып алушылар бот жауабын алмайды.",
      webhook:
        "Платформа мен арна арасындағы байланыс өшірулі: бот сатып алушылардың хабарын көрмейді.",
      failures: "Сатып алушыларға хабарлар қатарынан жетпейді: бот бекер жауап береді.",
    },
    button: "Қайта қосу",
    upTitle: (ch) => `✅ <b>${ch} қайта жұмыс істейді</b>`,
    upBody: "Бот хабарларды қайта көріп, сатып алушыларға жауап береді.",
  },
  en: {
    downTitle: (ch, at) => `🔌 <b>${ch} has been down since ${at}</b>`,
    downBody: {
      token: "The account's authorization expired: buyers are not getting the bot's replies.",
      webhook: "The platform's link to the channel is off: the bot cannot see buyers' messages.",
      failures: "Messages to buyers keep failing: the bot's replies are not getting through.",
    },
    button: "Reconnect",
    upTitle: (ch) => `✅ <b>${ch} is working again</b>`,
    upBody: "The bot sees messages and replies to buyers again.",
  },
  uz: {
    downTitle: (ch, at) => `🔌 <b>${ch} soat ${at} dan beri uzilgan</b>`,
    downBody: {
      token: "Akkaunt avtorizatsiyasi tugagan: xaridorlar botning javoblarini olmayapti.",
      webhook:
        "Platforma va kanal oʻrtasidagi aloqa oʻchirilgan: bot xaridorlar xabarini koʻrmayapti.",
      failures: "Xaridorlarga xabarlar ketma-ket yetib bormayapti: bot javoblari yetmayapti.",
    },
    button: "Qayta ulash",
    upTitle: (ch) => `✅ <b>${ch} yana ishlayapti</b>`,
    upBody: "Bot xabarlarni yana koʻradi va xaridorlarga javob beradi.",
  },
};

/** Время «14:05» в часовом поясе магазина. */
export function clockAt(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

export function downText(locale: Locale, platform: GuardPlatform, e: GuardEntry, tz: string) {
  const w = WORDS[locale];
  return `${w.downTitle(CHANNEL[platform], clockAt(e.since, tz))}\n\n${w.downBody[e.reason]}`;
}

export function upText(locale: Locale, platform: GuardPlatform) {
  const w = WORDS[locale];
  return `${w.upTitle(CHANNEL[platform])}\n\n${w.upBody}`;
}

export const reconnectLabel = (locale: Locale) => WORDS[locale].button;

/** Для таблицы оператора: коротко, что и с какого часа. */
export function operatorHint(e: GuardEntry, tz: string): string {
  const why = { token: "токен слетел", webhook: "вебхук отключён", failures: "сбои отправки" }[
    e.reason
  ];
  return `не отвечает с ${clockAt(e.since, tz)} (${why})`;
}
