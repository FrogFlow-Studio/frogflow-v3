import type { Locale } from "@/core/i18n/locale";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ConsultantProduct } from "@/core/consultant/pricelist/catalog";
import { escapeHtml } from "@/channels/telegram/copy";
import {
  conversationProductLines,
  productLine,
  productLines,
} from "@/core/consultant/pricelist/handoff-products";
import type { ZernioPlatform } from "./platform";

/**
 * Карточка передачи менеджеру от консультанта (перенос v1
 * consultant/notify.ts:75-121): товары, о которых шла речь, — название,
 * размер, цвет и цена в тенге, — и кнопка, открывающая этот диалог в
 * Instagram или WhatsApp. Менеджеру не надо листать переписку, чтобы понять,
 * о чём спрашивали.
 */

const LABEL: Record<Locale, { one: string; many: string }> = {
  ru: { one: "🏷 Товар:", many: "🏷 Товары:" },
  kk: { one: "🏷 Тауар:", many: "🏷 Тауарлар:" },
  en: { one: "🏷 Product:", many: "🏷 Products:" },
  uz: { one: "🏷 Mahsulot:", many: "🏷 Mahsulotlar:" },
};

const OPEN_DIALOG: Record<Locale, Record<"instagram" | "inbox" | "whatsapp", string>> = {
  ru: {
    instagram: "💬 Открыть диалог в Instagram",
    inbox: "💬 Открыть Instagram Direct",
    whatsapp: "💬 Открыть чат в WhatsApp",
  },
  kk: {
    instagram: "💬 Instagram-да диалогты ашу",
    inbox: "💬 Instagram Direct ашу",
    whatsapp: "💬 WhatsApp-та чатты ашу",
  },
  en: {
    instagram: "💬 Open the chat in Instagram",
    inbox: "💬 Open Instagram Direct",
    whatsapp: "💬 Open the chat in WhatsApp",
  },
  uz: {
    instagram: "💬 Instagram’da suhbatni ochish",
    inbox: "💬 Instagram Direct’ni ochish",
    whatsapp: "💬 WhatsApp’da chatni ochish",
  },
};

export { productLine };

/** Строки карточки о товарах (HTML): неизвестные коды пропускаются, повторы схлопываются. */
export function handoffProductLines(
  ids: readonly string[] | undefined,
  catalog: readonly ConsultantProduct[],
  locale: Locale,
): string[] {
  return productCardLines(productLines(ids, catalog), locale);
}

/** Готовые строки товаров → строки карточки (HTML) с подписью на языке продавца. */
export function productCardLines(products: readonly string[], locale: Locale): string[] {
  const lines = products.map((l) => escapeHtml(l));
  if (!lines.length) return [];
  const label = LABEL[locale];
  return lines.length === 1
    ? [`${label.one} ${lines[0]}`]
    : [label.many, ...lines.map((l) => `  • ${l}`)];
}

/**
 * Кнопка «открыть диалог»: Instagram — ig.me/m/<ник> (без ника — входящие
 * Direct), WhatsApp — wa.me/<номер>. Без ника и номера в WhatsApp — без кнопки.
 */
export function openDialogMarkup(
  platform: ZernioPlatform,
  who: { username?: string | null; phone?: string | null },
  locale: Locale,
): { inline_keyboard: Array<Array<{ text: string; url: string }>> } | undefined {
  const t = OPEN_DIALOG[locale];
  if (platform === "whatsapp") {
    const digits = (who.phone ?? "").replace(/\D/g, "");
    return digits.length >= 7
      ? { inline_keyboard: [[{ text: t.whatsapp, url: `https://wa.me/${digits}` }]] }
      : undefined;
  }
  const nick = (who.username ?? "").replace(/^@/, "").trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(nick)
    ? { inline_keyboard: [[{ text: t.instagram, url: `https://ig.me/m/${nick}` }]] }
    : {
        inline_keyboard: [[{ text: t.inbox, url: "https://www.instagram.com/direct/inbox/" }]],
      };
}

type Markup = ReturnType<typeof openDialogMarkup>;

/**
 * Что добавить в карточку передачи: строки о товарах последних ответов
 * консультанта по прайсу (core/consultant/pricelist/handoff-products) и кнопку
 * диалога. `products` и `link` — те же товары строками и адрес кнопки, для
 * задачи консультанта в админке. Сбой чтения прайса или покупателя — карточка
 * уходит без товаров.
 */
export async function handoffCardExtras(
  ctx: TenantContext,
  customer: Customer,
  m: {
    platform: ZernioPlatform;
    senderUsername?: string | null;
    senderPhone?: string | null;
    senderId: string;
  },
): Promise<{ lines: string[]; replyMarkup: Markup; products: string[]; link: string | null }> {
  const { sellerLocaleSafe } = await import("@/core/ai/seller-text");
  const locale = await sellerLocaleSafe(ctx);
  const replyMarkup = openDialogMarkup(
    m.platform,
    {
      username: m.senderUsername || customer.username,
      phone: m.senderPhone || customer.contactPhone || m.senderId,
    },
    locale,
  );
  const link = replyMarkup?.inline_keyboard[0]?.[0]?.url ?? null;
  const products = await conversationProductLines(ctx, customer);
  return { lines: productCardLines(products, locale), replyMarkup, products, link };
}
