import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Locale } from "@/core/i18n/locale";
import type { Customer } from "@/core/customers/customers";
import { claimStateSection } from "@/core/customers/customers";
import { escapeHtml } from "@/channels/telegram/copy";
import { PLATFORM_LABEL } from "./platform";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import type { ZernioInboxMessage } from "./inbox-types";

/**
 * «Позвать продавца» (Б9). Покупатель в Direct/WhatsApp пишет «человек»,
 * «менеджер», «оператор», «продавец»: бот в этом диалоге замолкает (та же
 * пауза, что Б3), продавцу в Telegram уходит карточка с последними тремя
 * сообщениями, ответ свайпом на карточку уходит покупателю в его канал
 * (relayManagerReply). Метку «позвал» ставит условная запись до отправки:
 * повтор слова в течение получаса ничего не шлёт ни продавцу, ни покупателю.
 */

/** Сколько повторное «человек» не поднимает продавца второй раз. */
export const HUMAN_CALL_WINDOW_MS = 30 * 60_000;

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const WHO_RU = "(?:человека|человек|оператора|оператор|менеджера|менеджер|продавца|продавец)";
const PATTERNS: RegExp[] = [
  new RegExp(
    `^(?:(?:позови|позовите|позвать|вызови|вызовите|хочу|нужен|нужна|можно|дайте|соедините|соедини)\\s+)*(?:(?:живого|живой|настоящего|реального)\\s+)?${WHO_RU}(?:\\s+пожалуйста)?$`,
  ),
  new RegExp(
    `^(?:хочу\\s+|можно\\s+)?(?:поговорить|связаться|соедините|соедини)\\s+(?:с|к)\\s+(?:живым\\s+)?(?:человеком|оператором|менеджером|продавцом)(?:\\s+пожалуйста)?$`,
  ),
  /^(?:тірі\s+)?(?:адам|сатушы|менеджер|оператор)(?:ды|ны|ді|ні)?(?:\s+(?:шақыр|шақырыңыз|шақыру|керек))?$/,
  /^(?:(?:call|get|i want|i need|need|talk to|speak to|speak with|connect me to|connect me with)\s+)*(?:(?:a|the|real|live)\s+)*(?:human|person|operator|manager|seller|agent)(?:\s+please)?$/,
  /^(?:jonli\s+)?(?:odam|inson|sotuvchi|menejer|operator)(?:ni|ga)?(?:\s+(?:chaqiring|chaqir|kerak))?$/,
];

/** Весь текст — просьба позвать человека. Фраза внутри длинного вопроса не считается. */
export function isHumanCallWord(text: string | null | undefined): boolean {
  const t = norm(text ?? "");
  return t.length > 0 && t.length <= 60 && PATTERNS.some((re) => re.test(t));
}

const BUYER_REPLY: Record<Locale, string> = {
  ru: "🙋 Позвал продавца — он ответит вам здесь. Пока бот помолчит.",
  kk: "🙋 Сатушыны шақырдым — ол сізге осы жерде жауап береді. Бот әзірге үнсіз.",
  en: "🙋 I've called the seller — they will reply to you here. The bot stays quiet meanwhile.",
  uz: "🙋 Sotuvchini chaqirdim — u shu yerda javob beradi. Bot hozircha jim turadi.",
};

type CardTexts = {
  title: (who: string, channel: string) => string;
  recent: string;
  buyer: string;
  shop: string;
  noMessages: string;
  tail: string;
  hint: string;
};

const CARD: Record<Locale, CardTexts> = {
  ru: {
    title: (w, c) => `🙋 <b>Покупатель ждёт: ${w}</b> (${c})`,
    recent: "Последние сообщения:",
    buyer: "Покупатель",
    shop: "Магазин",
    noMessages: "Переписку прочитать не удалось — откройте диалог в приложении.",
    tail: "Бот в этом диалоге помолчит.",
    hint: "↩️ Ответьте на это сообщение свайпом — текст уйдёт покупателю в его канал от имени магазина.",
  },
  kk: {
    title: (w, c) => `🙋 <b>Сатып алушы күтіп тұр: ${w}</b> (${c})`,
    recent: "Соңғы хабарламалар:",
    buyer: "Сатып алушы",
    shop: "Дүкен",
    noMessages: "Хат алмасуды оқу мүмкін болмады — диалогты қолданбада ашыңыз.",
    tail: "Бот бұл диалогта үнсіз болады.",
    hint: "↩️ Осы хабарламаға свайппен жауап беріңіз — мәтін сатып алушыға оның арнасына дүкен атынан кетеді.",
  },
  en: {
    title: (w, c) => `🙋 <b>A buyer is waiting: ${w}</b> (${c})`,
    recent: "Last messages:",
    buyer: "Buyer",
    shop: "Shop",
    noMessages: "Couldn't read the conversation — open the chat in the app.",
    tail: "The bot stays quiet in this chat.",
    hint: "↩️ Reply to this message (swipe) — the text goes to the buyer in their channel on behalf of the shop.",
  },
  uz: {
    title: (w, c) => `🙋 <b>Xaridor kutmoqda: ${w}</b> (${c})`,
    recent: "Oxirgi xabarlar:",
    buyer: "Xaridor",
    shop: "Doʻkon",
    noMessages: "Yozishmani oʻqib boʻlmadi — suhbatni ilovada oching.",
    tail: "Bot bu suhbatda jim turadi.",
    hint: "↩️ Shu xabarga svayp bilan javob bering — matn xaridorga uning kanaliga doʻkon nomidan ketadi.",
  },
};

/** Последние три сообщения переписки (по возрастанию), каждое до 200 знаков. */
export function lastMessages(tail: ZernioInboxMessage[], count = 3): ZernioInboxMessage[] {
  return tail.filter((x) => (x.message ?? "").trim()).slice(-count);
}

export function humanCallCard(
  locale: Locale,
  who: string,
  channel: string,
  messages: ZernioInboxMessage[] | null,
  hint: string = CARD[locale].hint,
): { html: string; hint: string } {
  const c = CARD[locale];
  const lines =
    messages && messages.length
      ? messages.map(
          (x) =>
            `— ${x.direction === "outgoing" ? c.shop : c.buyer}: ${escapeHtml((x.message ?? "").trim().slice(0, 200))}`,
        )
      : [c.noMessages];
  return {
    html: [
      c.title(escapeHtml(who), channel),
      "",
      messages && messages.length ? c.recent : "",
      ...lines,
      "",
      c.tail,
    ]
      .filter((x, i, a) => !(x === "" && a[i - 1] === ""))
      .join("\n"),
    hint,
  };
}

type DirectSection = { human_call_at?: string; [k: string]: unknown };

/**
 * Обработать «позови человека». true — сообщение обработано (бот молчит дальше
 * по этому сообщению), false — продавцу писать некуда, диалог идёт как обычно.
 */
export async function callHuman(
  ctx: TenantContext,
  customer: Customer,
  m: ParsedZernioMessage,
  transport: ZernioTransport,
  now = Date.now(),
): Promise<{ handled: boolean; customer: Customer; note: string }> {
  const { adminRecipients } = await import("@/core/notify/recipients");
  const { accountId, conversationId } = m;
  if (!accountId || !conversationId) return { handled: false, customer, note: "нет диалога" };
  if (!(await adminRecipients(ctx)).length)
    return { handled: false, customer, note: "некому позвать" };
  const iso = new Date(now).toISOString();
  // Метка до отправки: из двух одинаковых сообщений карточку шлёт тот, чья запись прошла.
  const claimed = await claimStateSection(ctx, customer, "direct", (cur) => {
    const at = Date.parse(String((cur as DirectSection).human_call_at ?? ""));
    if (Number.isFinite(at) && now - at < HUMAN_CALL_WINDOW_MS) return null;
    // seller_at/seller_noted — пауза Б3 без отдельного «вы ответили сами».
    return { ...cur, human_call_at: iso, seller_at: iso, seller_noted: iso };
  });
  if (!claimed) return { handled: true, customer, note: "продавца уже позвали" };

  let tail: ZernioInboxMessage[] | null = null;
  try {
    tail = await transport.tail(accountId, conversationId);
  } catch (e) {
    console.warn(`[zernio] переписка не прочитана для карточки ${customer.userKey}: ${String(e)}`);
  }
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const locale = await sellerLocale(ctx).catch(() => ctx.tenant.settings.default_locale ?? "ru");
  const who =
    customer.firstName || (customer.username ? `@${customer.username}` : customer.userKey);
  const card = humanCallCard(
    locale,
    who,
    PLATFORM_LABEL[m.platform],
    tail ? lastMessages(tail) : null,
  );
  // Задача консультанта в админке (консультант по прайсу) — после метки «позвал»,
  // поэтому повтор слова её не задваивает.
  const { taskFromHandoff } = await import("@/core/consultant/tasks");
  const { conversationProductLines } = await import("@/core/consultant/pricelist/handoff-products");
  const { openDialogMarkup } = await import("./handoff-card");
  await taskFromHandoff(
    ctx,
    claimed,
    { reason: "human_requested", summary: `«${(m.text ?? "").trim().slice(0, 300)}»` },
    {
      channel: m.platform,
      products: await conversationProductLines(ctx, claimed),
      link:
        openDialogMarkup(
          m.platform,
          {
            username: m.senderUsername || customer.username,
            phone: m.senderPhone || customer.contactPhone || m.senderId,
          },
          locale,
        )?.inline_keyboard[0]?.[0]?.url ?? null,
      sourceId: m.platformMessageId,
    },
  );
  const { handoffRefLine, issueHandoffRef } = await import("@/core/consultant/relay");
  const ref = await issueHandoffRef(ctx, customer.userKey).catch(() => null);
  const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
  await notifyAdminsHtml(ctx, ref ? `${card.html}\n${handoffRefLine(ref, card.hint)}` : card.html, {
    kind: "question",
  }).catch(() => 0);

  let current = claimed;
  const consultant = await import("@/core/consultant/engine.server");
  if (await consultant.consultantEnabled(ctx))
    current = await consultant.pauseConsultant(ctx, current);

  const buyerLocale = customer.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
  const text = BUYER_REPLY[buyerLocale] ?? BUYER_REPLY.ru;
  const r = await transport.send(conversationId, accountId, text, { platform: m.platform });
  if (r.ok && ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(ctx, {
      telegramId: customer.telegramId,
      direction: "out",
      sender: "bot",
      text,
    }).catch(() => {});
  }
  return { handled: true, customer: current, note: "позвали продавца" };
}
