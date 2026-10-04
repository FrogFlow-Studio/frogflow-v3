import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { Locale } from "@/core/i18n/locale";
import { enterFromTelegram, type MembershipCheck } from "@/core/giveaways/entry";
import { escapeHtml } from "./copy";
import type { TelegramApi } from "./api";

/** Тексты участия в розыгрыше для покупателя — ru, kk, en, uz. */
type Copy = {
  entered: (title: string, prize: string) => string;
  already: string;
  closed: string;
  blocked: string;
  notFound: string;
  needSubscription: (title: string) => string;
  checkFailed: string;
  subscribe: string;
  recheck: string;
};

const COPY: Record<Locale, Copy> = {
  ru: {
    entered: (t, p) =>
      `🎉 Вы участвуете в розыгрыше «${t}»!\nПриз: ${p}\nИтоги — по окончании срока.`,
    already: "Вы уже участвуете в этом розыгрыше.",
    closed: "Приём участников в этом розыгрыше закончился.",
    blocked: "Участие в этом розыгрыше для вас недоступно.",
    notFound: "Розыгрыш не найден.",
    needSubscription: (t) =>
      `Чтобы участвовать в розыгрыше «${t}», подпишитесь на канал и нажмите «Проверить ещё раз».`,
    checkFailed: "Не удалось проверить подписку. Попробуйте чуть позже.",
    subscribe: "Подписаться на канал",
    recheck: "Проверить ещё раз",
  },
  kk: {
    entered: (t, p) =>
      `🎉 Сіз «${t}» ұтыс ойынына қатысып жатырсыз!\nСыйлық: ${p}\nҚорытынды — мерзім біткенде.`,
    already: "Сіз бұл ұтыс ойынына қатысып жатырсыз.",
    closed: "Бұл ұтыс ойынына қатысушыларды қабылдау аяқталды.",
    blocked: "Бұл ұтыс ойынына қатысу сізге қолжетімсіз.",
    notFound: "Ұтыс ойыны табылмады.",
    needSubscription: (t) =>
      `«${t}» ұтыс ойынына қатысу үшін арнаға жазылып, «Қайта тексеру» түймесін басыңыз.`,
    checkFailed: "Жазылымды тексеру мүмкін болмады. Сәлден кейін қайталап көріңіз.",
    subscribe: "Арнаға жазылу",
    recheck: "Қайта тексеру",
  },
  en: {
    entered: (t, p) =>
      `🎉 You are in the “${t}” giveaway!\nPrize: ${p}\nResults when the deadline passes.`,
    already: "You are already in this giveaway.",
    closed: "Entries for this giveaway are closed.",
    blocked: "You cannot enter this giveaway.",
    notFound: "Giveaway not found.",
    needSubscription: (t) =>
      `To enter the “${t}” giveaway, subscribe to the channel and tap “Check again”.`,
    checkFailed: "We could not check your subscription. Please try again a little later.",
    subscribe: "Subscribe to the channel",
    recheck: "Check again",
  },
  uz: {
    entered: (t, p) =>
      `🎉 Siz «${t}» sovrin o‘yinida qatnashyapsiz!\nSovg‘a: ${p}\nNatijalar — muddat tugagach.`,
    already: "Siz bu sovrin o‘yinida allaqachon qatnashyapsiz.",
    closed: "Bu sovrin o‘yinida ishtirokchilarni qabul qilish tugadi.",
    blocked: "Bu sovrin o‘yinida qatnashish siz uchun mumkin emas.",
    notFound: "Sovrin o‘yini topilmadi.",
    needSubscription: (t) =>
      `«${t}» sovrin o‘yinida qatnashish uchun kanalga obuna bo‘ling va «Qayta tekshirish» tugmasini bosing.`,
    checkFailed: "Obunani tekshirib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.",
    subscribe: "Kanalga obuna bo‘lish",
    recheck: "Qayta tekshirish",
  },
};

const JOIN: Record<Locale, string> = {
  ru: "🎁 Участвовать",
  kk: "🎁 Қатысу",
  en: "🎁 Enter the giveaway",
  uz: "🎁 Qatnashish",
};

/** Подпись кнопки под рассылкой. */
export const giveawayJoinLabel = (locale: Locale) => JOIN[locale];

export const GIVEAWAY_START_PREFIX = "gw_";
export const GIVEAWAY_CALLBACK = "gw:";

/** Участие нажатием на кнопку в рассылке (`gw:<id>`) или по ссылке; повторная проверка — тем же. */
export function giveawayIdFrom(data: string): string | null {
  const m = /^(?:gw:|gw_|gwchk:)([a-z0-9]{8})$/.exec(data);
  return m ? m[1]! : null;
}

export function membership(api: TelegramApi): MembershipCheck {
  return async (channel, telegramId) => {
    const r = await api.call<{ status?: string }>("getChatMember", {
      chat_id: channel,
      user_id: telegramId,
    });
    if (!r.ok) return null;
    return ["member", "administrator", "creator", "restricted"].includes(r.result?.status ?? "");
  };
}

export async function giveawayEntry(
  ctx: TenantContext,
  api: TelegramApi,
  chatId: number,
  customer: Customer,
  locale: Locale,
  giveawayId: string,
): Promise<void> {
  const m = COPY[locale];
  const say = (text: string, extra: Record<string, unknown> = {}) =>
    api.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    });
  const r = await enterFromTelegram(
    ctx,
    giveawayId,
    { userKey: customer.userKey, telegramId: customer.telegramId },
    membership(api),
  );
  switch (r.status) {
    case "entered":
      await say(m.entered(escapeHtml(r.giveaway.title), escapeHtml(r.giveaway.prize)));
      return;
    case "already":
      await say(m.already);
      return;
    case "closed":
      await say(m.closed);
      return;
    case "blocked":
      await say(m.blocked);
      return;
    case "notFound":
      await say(m.notFound);
      return;
    case "checkFailed":
      await say(m.checkFailed);
      return;
    case "needSubscription":
      await say(m.needSubscription(escapeHtml(r.giveaway.title)), {
        reply_markup: {
          inline_keyboard: [
            [{ text: m.subscribe, url: `https://t.me/${r.giveaway.subscribeChannel.slice(1)}` }],
            [{ text: m.recheck, callback_data: `gwchk:${r.giveaway.id}` }],
          ],
        },
      });
      return;
  }
}
