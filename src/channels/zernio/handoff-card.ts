import type { Locale } from "@/core/i18n/locale";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ConsultantProduct } from "@/core/consultant/pricelist/catalog";
import { escapeHtml } from "@/channels/telegram/copy";
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

/** Строка товара: «Название 70x140, белый (55 000 ₸)»; размер и цвет — если их нет в названии. */
export function productLine(p: ConsultantProduct): string {
  const size = p.size && !p.name.includes(p.size) ? ` ${p.size}` : "";
  const lower = p.name.toLowerCase();
  const own = (p.colors ?? []).filter((c) => c && !lower.includes(c.toLowerCase()));
  const colors = own.length ? `, ${own.join("/")}` : "";
  const price = p.price_kzt ? ` (${p.price_kzt.toLocaleString("ru-RU")} ₸)` : "";
  return `${p.name}${size}${colors}${price}`;
}

/** Строки карточки о товарах (HTML): неизвестные коды пропускаются, повторы схлопываются. */
export function handoffProductLines(
  ids: readonly string[] | undefined,
  catalog: readonly ConsultantProduct[],
  locale: Locale,
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const id of ids ?? []) {
    const p = catalog.find((c) => c.id === id);
    if (!p) continue;
    const line = productLine(p);
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(escapeHtml(line));
    if (lines.length >= 5) break;
  }
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
 * консультанта по прайсу (state.consultant.last_product_ids — перечитываем,
 * runConsultant только что записал их поверх свежего состояния) и кнопку
 * диалога. Сбой чтения прайса или покупателя — карточка уходит без товаров.
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
): Promise<{ lines: string[]; replyMarkup: Markup }> {
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
  const { pricelistMode } = await import("@/core/consultant/pricelist/mode");
  if (!pricelistMode(ctx.tenant)) return { lines: [], replyMarkup };
  try {
    const { getCustomer } = await import("@/core/customers/customers");
    const { loadPricelist } = await import("@/core/consultant/pricelist/catalog.server");
    const [fresh, snap] = await Promise.all([
      getCustomer(ctx, customer.userKey),
      loadPricelist(ctx),
    ]);
    const c = ((fresh ?? customer).state.consultant ?? {}) as { last_product_ids?: unknown };
    const ids = Array.isArray(c.last_product_ids) ? c.last_product_ids.map(String) : [];
    return {
      lines: handoffProductLines(ids, [...snap.products, ...snap.hidden], locale),
      replyMarkup,
    };
  } catch (e) {
    console.warn(`[zernio:${ctx.tenant.id}] товары для карточки передачи не прочитаны`, e);
    return { lines: [], replyMarkup };
  }
}
