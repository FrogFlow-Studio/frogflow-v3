import type { TenantContext } from "@/core/tenant/resolve.server";
import { nonceFromMessage } from "@/core/storefront/code-login";
import type { Locale } from "@/core/i18n/locale";
import type { Customer } from "@/core/customers/customers";
import { claimStateSection } from "@/core/customers/customers";
import { utcToZonedLocal, zonedDayToUtc } from "@/core/export/csv";
import type { SellerPause } from "@/core/instagram/direct-bot-settings";
import { isShopStartWord } from "@/core/instagram/comment-rules";
import { escapeHtml } from "@/channels/telegram/copy";
import { PLATFORM_LABEL } from "./platform";
import { lastPersonMessageAt } from "./manager-guard";
import { matchDirectCommand } from "./shop-flow";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";

/**
 * «Продавец в диалоге — бот на паузе» (Б3). Продавец ответил покупателю руками
 * из приложения Instagram/WhatsApp или из инбокса Zernio: на `sellerPause`
 * (15/30/60 минут или до конца дня магазина) бот в этом диалоге отвечает только
 * на явные команды. Реплику продавца видим двумя путями: событием исходящего
 * сообщения (если Zernio его прислал) и хвостом переписки перед ответом.
 */

const MINUTES: Record<Exclude<SellerPause, "day">, number> = {
  "15": 15 * 60_000,
  "30": 30 * 60_000,
  "60": 60 * 60_000,
};

/** Когда пауза, начатая репликой в `lastAt` (мс), заканчивается. «До конца дня» — по часам магазина. */
export function pauseEndsAt(lastAt: number, pause: SellerPause, timezone: string): number {
  if (pause !== "day") return lastAt + MINUTES[pause];
  const day = utcToZonedLocal(new Date(lastAt).toISOString(), timezone).slice(0, 10);
  return Date.parse(zonedDayToUtc(day, timezone, true));
}

/**
 * Что бот понимает и в паузе: нажатие кнопки, команда словом («меню»,
 * «корзина»…), слово «старт», корзина из каталога и чек на шаге оплаты
 * (деньги покупателя в паузу не уходят).
 */
export function isExplicitCommand(m: ParsedZernioMessage, mode: string | undefined): boolean {
  if (m.postbackPayload || m.nativeOrder) return true;
  if (matchDirectCommand(m.text) || isShopStartWord(m.text) || nonceFromMessage(m.text))
    return true;
  const proofStep = ["awaiting_proof", "awaiting_payment", "choose_pay", "awaiting_balance_proof"];
  return m.attachments.length > 0 && proofStep.includes(mode ?? "");
}

const NOTE: Record<Locale, (who: string, channel: string, until: string) => string> = {
  ru: (who, ch, until) =>
    `⏸ Бот на паузе в диалоге с ${who} (${ch}): вы ответили сами. Снова отвечает после ${until}.`,
  kk: (who, ch, until) =>
    `⏸ ${who} (${ch}) диалогында бот үзілісте: сіз өзіңіз жауап бердіңіз. ${until} кейін қайта жауап береді.`,
  en: (who, ch, until) =>
    `⏸ Bot paused in the dialogue with ${who} (${ch}): you replied yourself. It answers again after ${until}.`,
  uz: (who, ch, until) =>
    `⏸ ${who} (${ch}) bilan suhbatda bot pauzada: siz o‘zingiz javob berdingiz. ${until} dan keyin yana javob beradi.`,
};

type DirectSection = { seller_at?: string; seller_noted?: string; [k: string]: unknown };

function directOf(customer: Customer): DirectSection {
  const d = customer.state.direct;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as DirectSection) : {};
}

/**
 * Записать реплику продавца (`at`, мс) и, если эта пауза ещё не объявлена,
 * сказать продавцу одну строку. Условная запись по `direct.rev` и `state.mode`:
 * из двух событий одновременно строку шлёт тот, чья запись прошла.
 */
async function noteSellerReply(
  ctx: TenantContext,
  customer: Customer,
  at: number,
  endsAt: number,
  channel: string,
): Promise<Customer> {
  const iso = new Date(at).toISOString();
  let announce = false;
  const claimed = await claimStateSection(ctx, customer, "direct", (cur) => {
    const sec = cur as DirectSection;
    announce = sec.seller_noted !== iso;
    const known = sec.seller_at ? Date.parse(sec.seller_at) : 0;
    if (!announce && known >= at) return null;
    return { ...cur, seller_at: known > at ? sec.seller_at : iso, seller_noted: iso };
  });
  if (!claimed || !announce) return claimed ?? customer;
  const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const locale = await sellerLocale(ctx).catch(() => ctx.tenant.settings.default_locale ?? "ru");
  const who = customer.username ? `@${customer.username}` : customer.firstName || customer.userKey;
  const until = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ctx.timezone,
  }).format(endsAt);
  await notifyAdminsHtml(ctx, NOTE[locale](escapeHtml(who), channel, until), {
    kind: "system",
  }).catch(() => 0);
  return claimed;
}

/**
 * Событие «исходящее сообщение»: если его написал человек — пауза начинается
 * с его времени. Покупателя не создаём: нет карточки — бот в этом диалоге ещё не говорил.
 */
export async function handleSellerOutgoing(
  ctx: TenantContext,
  customer: Customer,
  m: ParsedZernioMessage,
  pause: SellerPause,
  lastBotReply: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (m.sentVia !== null && m.sentVia !== "human") return false;
  const ours = lastBotReply ? [lastBotReply] : [];
  const sentAt = m.sentAt ? Date.parse(m.sentAt) : now;
  const at = Number.isFinite(sentAt) ? sentAt : now;
  if (
    lastPersonMessageAt(
      [
        {
          direction: "outgoing",
          message: m.text,
          sentVia: m.sentVia,
          createdAt: new Date(at).toISOString(),
        },
      ],
      ours,
    ) === null
  )
    return false;
  const endsAt = pauseEndsAt(at, pause, ctx.timezone);
  if (endsAt <= now) return false;
  await noteSellerReply(ctx, customer, at, endsAt, PLATFORM_LABEL[m.platform]);
  return true;
}

/**
 * Перед ответом бота: идёт ли пауза. true — молчим. Реплику продавца берём из
 * памяти (событие) и из хвоста переписки; хвост не прочитался — по памяти.
 */
export async function sellerPauseActive(
  ctx: TenantContext,
  customer: Customer,
  m: ParsedZernioMessage,
  transport: ZernioTransport,
  pause: SellerPause,
  now = Date.now(),
): Promise<{ paused: boolean; customer: Customer }> {
  if (isExplicitCommand(m, customer.state.mode)) return { paused: false, customer };
  const direct = directOf(customer);
  let last = direct.seller_at ? Date.parse(direct.seller_at) : null;
  if (m.accountId && m.conversationId) {
    try {
      const tail = await transport.tail(m.accountId, m.conversationId);
      const ours = typeof direct.last_reply === "string" ? [direct.last_reply] : [];
      const fromTail = lastPersonMessageAt(tail, ours);
      if (fromTail !== null && (last === null || fromTail > last)) last = fromTail;
    } catch (e) {
      console.warn(`[zernio] переписка не прочитана для паузы ${customer.userKey}: ${String(e)}`);
    }
  }
  if (last === null || !Number.isFinite(last)) return { paused: false, customer };
  const endsAt = pauseEndsAt(last, pause, ctx.timezone);
  if (endsAt <= now) return { paused: false, customer };
  const next = await noteSellerReply(ctx, customer, last, endsAt, PLATFORM_LABEL[m.platform]);
  return { paused: true, customer: next };
}
