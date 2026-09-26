import { env } from "@/config/env";
import { orderChannel } from "@/core/orders/pure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  setContactPhone,
  setEmail,
  setState,
  type Customer,
  type DialogState,
} from "@/core/customers/customers";
import type { Json } from "@/core/db-types";
import { isLocale, localeNames, type Locale } from "@/core/i18n/locale";
import {
  getProduct,
  imageUrl,
  listChildCategories,
  listProductsInCategory,
  searchProducts,
  sortedImages,
  sortedVariants,
  type Product,
} from "@/core/catalog/catalog";
import {
  addToCart,
  cartCount,
  clearCart,
  listCart,
  priceCart,
  removeCartItem,
} from "@/core/cart/cart";
import { formatMoney } from "@/core/money/money";
import { resolvePrice } from "@/core/pricing/pricing";
import {
  attachPaymentProof,
  cartSummary,
  deliverOrder,
  displayNo,
  getOrder,
  setOrderEmail,
  listActivePaymentMethods,
  listCustomerOrders,
  placeOrder,
  recentAwaitingPaymentOrder,
  type OrderWithItems,
  reorderIntoCart,
} from "@/core/orders/orders";
import {
  activeDeliveryZones,
  amountDueNow,
  fulfillmentSettings,
  maxLeadTimeDaysInCart,
  zoneFee,
} from "@/core/fulfillment/fulfillment";
import { addDaysToIso, isoToDisplay, parseDateInput, todayInTz } from "@/core/fulfillment/pure";
import { robokassaFor } from "@/core/payments/payment";
import { buildPaymentUrl } from "@/core/payments/robokassa";
import { formatRatingSummary } from "@/core/reviews/pure";
import { isDeliveryLangChoice } from "@/core/catalog/materials";
import { askDeliveryLangBeforeOrder, cartLanguageChoices } from "@/core/cart/languages";
import { localeFlags as flags, SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { COPY, escapeHtml, normalizePhone, type Msg } from "@/channels/telegram/copy";
import {
  adminTelegramApi,
  notifyAdminsHtml,
  notifyDeliveryFailure,
} from "@/channels/telegram/notify";
import {
  downloadAttachment,
  liveTransport,
  type DmButton,
  type ZernioTransport,
} from "./api.server";
import { zernioMaterialSender } from "./deliver";
import { isMailConfigured } from "@/core/mail/mail.server";
import type { NativeOrder, ParsedZernioMessage } from "./message";
import { describeNativeCart, matchNativeItems } from "@/core/whatsapp/native-cart";
import type { ZernioPlatform } from "./platform";
import {
  classifyIncoming,
  emailStep,
  extractEmail,
  extractProductNumber,
  isCancel,
  isPaymentComplaint,
  matchCountry,
  matchDeliveryLangChoice,
  matchDirectCommand,
  type DirectCommand,
  matchLocalePick,
  languagePickerText,
  stepAnswer,
  whatsappList,
  STEP_PREFIX,
  WA_LIST_MAX_ROWS,
  WA_LIST_PAGE,
  needsLocalePick,
  MAX_LOCALE_MISSES,
  matchOrdinal,
  matchZone,
  parseRemoveCommand,
  pickCartLineToRemove,
  pickReceiptAttachment,
  plain,
  productNumberFromKeywords,
  productNumberFromName,
} from "./shop-flow";
import { matchFulfillmentType } from "@/core/fulfillment/pure";
import {
  DEFAULT_DIRECT_BOT,
  isTriggerWord,
  type DirectBotSettings,
} from "@/core/instagram/direct-bot-settings";

/**
 * Магазин в Instagram Direct и WhatsApp (модули dm_shop / wa_shop). Тот же
 * сценарий, что у Telegram-бота, но текстом и тремя кнопками: у Direct нет
 * /start, клавиатур и документов, поэтому списки нумеруются, выбор — номером
 * или словом, а материалы выдаются ссылками. Бизнес-правила — в ядре.
 */
export type ShopOutcome =
  /** Ответили по сценарию. */
  | "handled"
  /** Свободный вопрос — пусть отвечает консультант или продавец. */
  | "question";

type DirectMemory = {
  /** Показанный нумерованный список: категории или товары. */
  list?: { kind: "categories" | "products" | "variants"; ids: string[]; at: string };
  last_reply?: string;
  last_reply_at?: string;
  locale_picked_at?: string;
  variant_product?: string;
  /** WhatsApp: покупатель отказался от почты — больше не спрашиваем. */
  email_skipped?: boolean;
};

type Shop = {
  ctx: TenantContext;
  customer: Customer;
  transport: ZernioTransport;
  conversationId: string;
  accountId: string;
  platform: ZernioPlatform;
  locale: Locale;
  m: Msg;
  /** Настройки автоответчика канала: слова-вызовы и что из магазина включено. */
  bot: DirectBotSettings;
};

const LIST_TTL_MS = 30 * 60 * 1000;
const REPEAT_WINDOW_MS = 90 * 1000;
const PAGE = 10;

function memory(c: Customer): DirectMemory {
  const d = c.state.direct;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as DirectMemory) : {};
}

async function remember(s: Shop, patch: Partial<DirectMemory>, state?: Partial<DialogState>) {
  const next = { ...memory(s.customer), ...patch };
  s.customer = await setState(s.ctx, s.customer, {
    ...s.customer.state,
    ...(state ?? {}),
    direct: next as Record<string, Json | undefined>,
  });
}

async function setMode(s: Shop, state: Partial<DialogState>) {
  s.customer = await setState(s.ctx, s.customer, { ...s.customer.state, ...state });
}

function localeOf(ctx: TenantContext, customer: Customer): Locale {
  const fromState = customer.state.locale;
  if (isLocale(fromState)) return fromState;
  return ctx.tenant.settings.default_locale ?? "ru";
}

function fingerprint(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Все ответы — через эту точку: повтор одного текста подряд подавляется
 * (доставка вебхука at-least-once, «Корзина пуста» дважды — из живой
 * переписки v1), неотправленный ответ последним не считается. `force` —
 * покупатель сам повторно вызвал то же меню.
 */
async function reply(
  s: Shop,
  html: string,
  opts: { buttons?: DmButton[]; attachmentUrl?: string; force?: boolean; interactive?: Json } = {},
): Promise<boolean> {
  const text = plain(html).slice(0, 2000);
  const mem = memory(s.customer);
  const mark = fingerprint(text);
  const fresh =
    Boolean(mem.last_reply_at) && Date.now() - Date.parse(mem.last_reply_at!) < REPEAT_WINDOW_MS;
  if (!opts.force && mem.last_reply === mark && fresh) return false;
  const r = await s.transport.send(s.conversationId, s.accountId, text, {
    platform: s.platform,
    buttons: opts.buttons,
    attachmentUrl: opts.attachmentUrl,
    attachmentType: opts.attachmentUrl ? "image" : undefined,
    interactive: opts.interactive,
  });
  if (!r.ok) {
    console.error(`[zernio-shop] reply failed for ${s.customer.userKey}: ${r.error}`);
    return false;
  }
  await remember(s, { last_reply: mark, last_reply_at: new Date().toISOString() });
  if (s.ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(s.ctx, {
      telegramId: s.customer.telegramId,
      direction: "out",
      sender: "bot",
      text,
    });
  }
  return true;
}

const BTN = {
  cart: (m: Msg): DmButton => ({ type: "postback", title: plain(m.cart), payload: "CART" }),
  catalog: (m: Msg): DmButton => ({
    type: "postback",
    title: plain(m.catalog),
    payload: "CATALOG",
  }),
  checkout: (m: Msg): DmButton => ({
    type: "postback",
    title: plain(m.checkoutBtn),
    payload: "CHECKOUT",
  }),
  clear: (m: Msg): DmButton => ({ type: "postback", title: plain(m.clearBtn), payload: "CLEAR" }),
  orders: (m: Msg): DmButton => ({ type: "postback", title: plain(m.myOrders), payload: "ORDERS" }),
};

function hint(s: Shop): string {
  return s.locale === "ru"
    ? "Напишите номер товара или «каталог»; «корзина» — что уже выбрано."
    : `${plain(s.m.catalog)} · ${plain(s.m.cart)} · ${plain(s.m.myOrders)}`;
}

export async function handleShopMessage(
  ctx: TenantContext,
  customer: Customer,
  msg: ParsedZernioMessage,
  transport: ZernioTransport = liveTransport,
  bot: DirectBotSettings = DEFAULT_DIRECT_BOT,
): Promise<{ outcome: ShopOutcome; customer: Customer }> {
  const locale = localeOf(ctx, customer);
  const s: Shop = {
    ctx,
    customer,
    transport,
    conversationId: msg.conversationId!,
    accountId: msg.accountId!,
    platform: msg.platform,
    locale,
    m: COPY[locale],
    bot,
  };
  const outcome = await route(s, msg);
  return { outcome, customer: s.customer };
}

async function route(s: Shop, msg: ParsedZernioMessage): Promise<ShopOutcome> {
  const text = msg.text;
  const mode = s.customer.state.mode;

  // Корзина из каталога Meta — штатная корзина WhatsApp мимо бота.
  if (msg.nativeOrder) return handleNativeCart(s, msg.nativeOrder);

  // Строка списка WhatsApp «STEP:<n>» — ответ на текущий шаг, как набранная цифра.
  const step = stepAnswer(msg.postbackPayload);
  if (step) return route(s, { ...msg, postbackPayload: null, text: step });
  if (msg.postbackPayload) return handlePostback(s, msg.postbackPayload);

  // Вложение без ссылки (Zernio сменил форму события): если ждём чек — просим
  // прислать ещё раз, а не отвечаем как на вопрос и не теряем его молча.
  if (msg.mediaWithoutUrl && msg.attachments.length === 0 && !text) {
    const waiting =
      ((mode === "awaiting_proof" || mode === "awaiting_payment") &&
        s.customer.state.pending_order_id) ||
      (await recentAwaitingPaymentOrder(s.ctx, s.customer));
    if (waiting) {
      console.warn(`[zernio:${s.ctx.tenant.id}] вложение без ссылки на шаге оплаты`);
      await reply(s, s.m.proofFailed, { force: true });
      return "handled";
    }
  }

  // Вложение: чек на шаге оплаты или по свежему открытому заказу.
  if (msg.attachments.length > 0) {
    const url = pickReceiptAttachment(msg.attachments);
    let orderId =
      (mode === "awaiting_proof" || mode === "awaiting_payment") &&
      s.customer.state.pending_order_id
        ? Number(s.customer.state.pending_order_id)
        : null;
    if (!orderId) orderId = await recentAwaitingPaymentOrder(s.ctx, s.customer);
    if (orderId && url) {
      await receiveProof(s, url, orderId);
      return "handled";
    }
    if (orderId) {
      await reply(s, s.m.sendReceiptPrompt);
      return "handled";
    }
    return text ? route(s, { ...msg, attachments: [] }) : "question";
  }

  if (!text) return "question";

  // Новому покупателю — выбор языка раньше чего бы то ни было, один раз.
  if (needsLocalePick(s.customer.state) && !memory(s.customer).locale_picked_at) {
    await askLocale(s);
    return "handled";
  }

  if (isCancel(text)) {
    await setMode(s, { mode: "idle" });
    await reply(s, `${plain(s.m.useMenu)}\n\n${hint(s)}`, {
      force: true,
      buttons: [BTN.catalog(s.m), BTN.cart(s.m)],
    });
    return "handled";
  }

  // Слова-вызовы продавца открывают магазин, как встроенная команда «каталог».
  const command = isTriggerWord(text, s.bot.triggers) ? "catalog" : matchDirectCommand(text);
  if (command) {
    if (!featureAllows(s, command)) return "question";
    if (mode && mode !== "idle" && mode !== "awaiting_proof") await setMode(s, { mode: "idle" });
    switch (command) {
      case "catalog":
        await showCatalog(s, null, 0, true);
        return "handled";
      case "cart":
        await showCart(s, true);
        return "handled";
      case "checkout":
        await startCheckout(s);
        return "handled";
      case "orders":
        await showOrders(s);
        return "handled";
      case "language":
        await askLocale(s);
        return "handled";
      case "country":
        await askCountry(s, false);
        return "handled";
    }
  }

  // Шаги сценария — текстом.
  switch (mode) {
    case "awaiting_locale": {
      const picked = matchLocalePick(text);
      if (!picked) {
        const misses = Number(s.customer.state.locale_misses ?? 0) + 1;
        if (misses < MAX_LOCALE_MISSES) {
          await setMode(s, { locale_misses: misses });
          return askLocale(s).then(() => "handled" as const);
        }
        // Не упорствуем: дальше отвечаем на языке магазина и показываем каталог.
        await remember(
          s,
          { locale_picked_at: new Date().toISOString() },
          { mode: "idle", locale: s.locale, locale_misses: undefined },
        );
        await showCatalog(s, null, 0, true);
        return "handled";
      }
      await remember(
        s,
        { locale_picked_at: new Date().toISOString() },
        { mode: "idle", locale: picked, locale_misses: undefined },
      );
      s.locale = picked;
      s.m = COPY[picked];
      await reply(s, s.m.languageSaved, { force: true });
      await showCatalog(s, null, 0, true);
      return "handled";
    }
    case "awaiting_country": {
      const methods = await listActivePaymentMethods(s.ctx);
      const picked = matchCountry(
        text,
        methods.map((x) => ({ code: x.country_code, name: x.country_name })),
      );
      if (!picked)
        return askCountry(s, s.customer.state.placing_order === true).then(
          () => "handled" as const,
        );
      const forCheckout = s.customer.state.placing_order === true;
      await setMode(s, {
        mode: "idle",
        country_code: picked.code,
        country_name: picked.name,
        placing_order: undefined,
      });
      await reply(s, s.m.countrySaved(picked.name), { force: true });
      if (forCheckout) await proceedToFulfillmentOrPlace(s, picked.code);
      return "handled";
    }
    case "awaiting_contact": {
      const phone = normalizePhone(text);
      if (!phone) return reply(s, s.m.phoneInvalid).then(() => "handled" as const);
      s.customer = await setContactPhone(s.ctx, s.customer, phone);
      await setMode(s, { mode: "idle" });
      await reply(s, s.m.contactSaved, { force: true });
      await continueCheckout(s);
      return "handled";
    }
    case "awaiting_variant_choice": {
      const mem = memory(s.customer);
      const pid = mem.variant_product;
      const ids = mem.list?.kind === "variants" ? mem.list.ids : [];
      const idx = matchOrdinal(text, ids.length);
      if (pid && idx !== null) {
        await setMode(s, { mode: "idle" });
        await addAndShowCart(s, pid, ids[idx]!);
        return "handled";
      }
      if (pid) {
        const p = await getProduct(s.ctx, pid);
        if (p) return sendProductCard(s, p, true).then(() => "handled" as const);
      }
      await setMode(s, { mode: "idle" });
      break;
    }
    case "awaiting_delivery_lang": {
      const langs = await cartLanguageChoices(s.ctx, s.customer);
      const choice = matchDeliveryLangChoice(text, langs);
      const cc = s.customer.state.country_code;
      if (!choice || !cc)
        return proceedToLanguageOrPlace(s, cc ?? "").then(() => "handled" as const);
      await setMode(s, { mode: "idle", delivery_lang: choice });
      await finishCheckout(s, cc);
      return "handled";
    }
    case "awaiting_fulfillment_type": {
      const type = matchFulfillmentType(text);
      if (!type) return reply(s, s.m.fulfillmentTypePrompt).then(() => "handled" as const);
      await setMode(s, { checkout_fulfillment_type: type });
      await askFulfillmentDate(s);
      return "handled";
    }
    case "awaiting_fulfillment_date": {
      const iso = parseDateInput(text);
      const minIso =
        s.customer.state.checkout_min_fulfillment_date ??
        addDaysToIso(todayInTz(s.ctx.timezone), await maxLeadTimeDaysInCart(s.ctx, s.customer));
      if (!iso) return reply(s, s.m.fulfillmentDateInvalid).then(() => "handled" as const);
      if (iso < minIso)
        return reply(s, s.m.fulfillmentDateTooEarly(isoToDisplay(minIso))).then(
          () => "handled" as const,
        );
      await setMode(s, { checkout_fulfillment_at: iso });
      await afterDate(s);
      return "handled";
    }
    case "awaiting_delivery_zone": {
      const zones = await activeDeliveryZones(s.ctx);
      const z = matchZone(text, zones);
      if (!z) return askZoneOrAddress(s).then(() => "handled" as const);
      await pickZone(s, z.id);
      return "handled";
    }
    case "awaiting_address": {
      await setMode(s, { checkout_fulfillment_address: text.slice(0, 500) });
      await askNote(s);
      return "handled";
    }
    case "awaiting_fulfillment_note": {
      await finishAfterNote(s, text.slice(0, 500));
      return "handled";
    }
    case "awaiting_email": {
      const email = extractEmail(text);
      if (!email) return reply(s, s.m.emailHint, { force: true }).then(() => "handled" as const);
      try {
        s.customer = await setEmail(s.ctx, s.customer, email);
      } catch (e) {
        // Шаг остаётся «жду почту»: покупатель пришлёт её ещё раз.
        console.error(`[zernio:${s.ctx.tenant.id}] почта покупателя: ${String(e)}`);
        await reply(s, s.m.emailSaveFailed, { force: true });
        return "handled";
      }
      await setMode(s, { mode: "idle" });
      const cc = s.customer.state.country_code;
      if (!cc) return askCountry(s, true).then(() => "handled" as const);
      await finishCheckout(s, cc);
      return "handled";
    }
    case "awaiting_order_email": {
      const email = extractEmail(text);
      if (!email) return reply(s, s.m.emailHint, { force: true }).then(() => "handled" as const);
      await saveOrderEmail(s, Number(s.customer.state.pending_order_id), email);
      return "handled";
    }
    case "awaiting_proof":
    case "choose_pay":
    case "awaiting_payment": {
      if (isPaymentComplaint(text)) return "question";
      const rm = parseRemoveCommand(text);
      if (!rm && extractProductNumber(text) === null && !matchDirectCommand(text)) {
        // Вопрос по ходу оплаты — человеку, но напомним про чек.
        await reply(s, s.m.sendReceiptPrompt);
        return "question";
      }
      break;
    }
    default:
      break;
  }

  const remove = parseRemoveCommand(text);
  if (remove) {
    await removeFromCart(s, remove);
    return "handled";
  }

  const kind = classifyIncoming(text);
  switch (kind.kind) {
    case "product_number": {
      if (!s.bot.features.search) return "question";
      await pickByNumber(s, kind.number);
      return "handled";
    }
    case "affirmative": {
      if (!s.bot.features.catalog) return "question";
      await showCatalog(s, null, 0, true);
      return "handled";
    }
    case "dismissal":
      // Разговор закрыт — не начинать его заново приветствием.
      return "handled";
    case "question":
      return "question";
  }
}

/**
 * Корзина из каталога Meta: позиции сопоставляются с товарами админки по
 * retailer id (id товара, номер или название). Совпало — в корзину и сразу к
 * оформлению; нет — продавцу в Telegram текстом, покупателю «передал».
 */
async function handleNativeCart(s: Shop, order: NativeOrder): Promise<ShopOutcome> {
  const { data } = await s.ctx.db
    .from("products")
    .select("id, name, keywords")
    .eq("is_active", true)
    .limit(1000);
  const match = matchNativeItems(order.items, data ?? []);
  const who = s.customer.username
    ? `@${s.customer.username}`
    : s.customer.firstName || s.customer.userKey;
  if (match.unmatched.length) {
    await notifyAdminsHtml(
      s.ctx,
      describeNativeCart(escapeHtml(who), match.unmatched, order.note) +
        (match.matched.length
          ? `\n\nОстальные позиции (${match.matched.map((m) => m.name).join(", ")}) бот положил в корзину покупателя.`
          : ""),
      { kind: "native_cart" },
    ).catch(() => 0);
  }
  if (!match.matched.length) {
    await reply(s, plain(s.m.nativeCartForwarded), { force: true });
    return "handled";
  }
  let added = 0;
  for (const m of match.matched)
    for (let i = 0; i < Math.min(m.quantity, 20); i++)
      if ((await addToCart(s.ctx, s.customer, m.productId)) === "ok") added++;
  if (!added) {
    await reply(s, plain(s.m.nativeCartForwarded), { force: true });
    return "handled";
  }
  await startCheckout(s);
  return "handled";
}

/** Выключенная продавцом часть магазина: команда и кнопка не отвечают, реплика уходит как вопрос. */
function featureAllows(s: Shop, command: DirectCommand | string): boolean {
  const f = s.bot.features;
  switch (command) {
    case "catalog":
    case "CATALOG":
    case "CAT":
    case "PROD":
      return f.catalog;
    case "cart":
    case "CART":
    case "BUY":
    case "CLEAR":
      return f.cart;
    case "checkout":
    case "CHECKOUT":
    case "PAY":
    case "FT":
    case "NOTE":
      return f.checkout;
    default:
      return true;
  }
}

async function handlePostback(s: Shop, payload: string): Promise<ShopOutcome> {
  const [head, a, b] = payload.split(":");
  if (head && !featureAllows(s, head)) return "question";
  switch (head) {
    case "CATALOG":
      await showCatalog(s, null, 0, true);
      return "handled";
    case "CAT":
      await showCatalog(s, a ?? null, Number(b ?? 0) || 0, true);
      return "handled";
    case "PROD": {
      const p = a ? await getProduct(s.ctx, a) : null;
      if (p) await sendProductCard(s, p, true);
      else await reply(s, s.m.productNotFound);
      return "handled";
    }
    case "BUY":
      if (a) await addAndShowCart(s, a, b ?? null);
      return "handled";
    case "CART":
      await showCart(s, true);
      return "handled";
    case "CLEAR":
      await clearCart(s.ctx, s.customer);
      await reply(s, s.m.cartCleared, { force: true, buttons: [BTN.catalog(s.m)] });
      return "handled";
    case "CHECKOUT":
      await startCheckout(s);
      return "handled";
    case "ORDERS":
      await showOrders(s);
      return "handled";
    case "WAIT": {
      if (!a || !s.ctx.tenant.modules.waitlist) return "question";
      const { joinWaitlist } = await import("@/core/waitlist/waitlist");
      s.customer = await joinWaitlist(s.ctx, s.customer, a);
      await reply(s, plain(s.m.waitlistJoined), { force: true, buttons: [BTN.catalog(s.m)] });
      return "handled";
    }
    case "REORDER": {
      const order = a ? await getOrder(s.ctx, Number(a)) : null;
      if (!order || order.telegram_id !== s.customer.telegramId) return "handled";
      const added = await reorderIntoCart(s.ctx, s.customer, order);
      if (!added) {
        await reply(s, plain(s.m.reorderNothing), { force: true, buttons: [BTN.catalog(s.m)] });
        return "handled";
      }
      await showCart(s, true, plain(s.m.reorderDone(added)));
      return "handled";
    }
    case "FT":
      if (a === "pickup" || a === "delivery") {
        await setMode(s, { checkout_fulfillment_type: a });
        await askFulfillmentDate(s);
      }
      return "handled";
    case "NOTE":
      await finishAfterNote(s, null);
      return "handled";
    case "EMAIL": {
      if (s.customer.state.mode !== "awaiting_email") return "handled";
      await remember(s, { email_skipped: true }, { mode: "idle" });
      const cc = s.customer.state.country_code;
      if (!cc) await askCountry(s, true);
      else await finishCheckout(s, cc);
      return "handled";
    }
    case "PAY":
      await choosePayment(s, a === "rk" ? "rk" : "manual");
      return "handled";
    default:
      // Чужой postback (например, из comment-автоматизации Zernio) — не наш.
      return "question";
  }
}

// ── каталог ───────────────────────────────────────────────────────────

async function showCatalog(s: Shop, categoryId: string | null, offset: number, force: boolean) {
  const cats = await listChildCategories(s.ctx, categoryId);
  if (cats.length > 0) {
    const PAGE = pageSize(s);
    const page = cats.slice(offset, offset + PAGE);
    const lines = page.map((c, i) => `${offset + i + 1}. ${c.name}`);
    const more = cats.length > offset + PAGE;
    await remember(s, {
      list: {
        kind: "categories",
        ids: cats.slice(0, offset + PAGE).map((c) => c.id),
        at: new Date().toISOString(),
      },
    });
    const buttons: DmButton[] = [];
    if (more)
      buttons.push({
        type: "postback",
        title: plain(s.m.showMore),
        payload: `CAT:${categoryId ?? ""}:${offset + PAGE}`,
      });
    buttons.push(BTN.cart(s.m));
    if (categoryId)
      buttons.push({ type: "postback", title: plain(s.m.backToCategories), payload: "CATALOG" });
    if (s.platform === "whatsapp") {
      await reply(s, plain(s.m.catalogHeader), {
        force,
        interactive: whatsappList({
          body: plain(s.m.catalogHeader),
          buttonLabel: plain(s.m.openCatalogBtn),
          sections: [
            {
              title: plain(s.m.catalogHeader),
              rows: page.map((c) => ({ id: `CAT:${c.id}:0`, title: c.name })),
            },
            { title: "…", rows: buttons.map((b) => ({ id: b.payload!, title: b.title })) },
          ],
        }),
      });
      return;
    }
    await reply(
      s,
      `${plain(s.m.catalogHeader)}\n\n${lines.join("\n")}\n\n${s.locale === "ru" ? "Напишите номер раздела." : plain(s.m.chooseSection)}`,
      { force, buttons: buttons.slice(0, 3) },
    );
    return;
  }
  const products = await listProductsInCategory(s.ctx, categoryId);
  if (products.length === 0) {
    await reply(s, s.m.emptyHere, { force, buttons: [BTN.catalog(s.m), BTN.cart(s.m)] });
    return;
  }
  await showProductList(s, products, offset, categoryId, force);
}

async function showProductList(
  s: Shop,
  products: Product[],
  offset: number,
  categoryId: string | null,
  force: boolean,
) {
  const country = s.customer.state.country_code ?? null;
  const PAGE = pageSize(s);
  const page = products.slice(offset, offset + PAGE);
  const prices = await Promise.all(
    page.map(async (p) => {
      const variants = sortedVariants(p);
      const money = variants.length
        ? await resolvePrice(s.ctx, p, country, variants[0])
        : await resolvePrice(s.ctx, p, country);
      return variants.length
        ? plain(s.m.priceFrom(formatMoney(money.amount, money.currency)))
        : formatMoney(money.amount, money.currency);
    }),
  );
  const lines = page.map((p, i) => `${offset + i + 1}. ${p.name} — ${prices[i]}`);
  await remember(s, {
    list: {
      kind: "products",
      ids: products.slice(0, offset + PAGE).map((p) => p.id),
      at: new Date().toISOString(),
    },
  });
  const buttons: DmButton[] = [];
  if (products.length > offset + PAGE)
    buttons.push({
      type: "postback",
      title: plain(s.m.showMore),
      payload: `CAT:${categoryId ?? ""}:${offset + PAGE}`,
    });
  buttons.push(BTN.cart(s.m));
  buttons.push(
    categoryId
      ? { type: "postback", title: plain(s.m.backToCategories), payload: "CATALOG" }
      : BTN.orders(s.m),
  );
  if (s.platform === "whatsapp") {
    await reply(s, plain(s.m.catalogHeader), {
      force,
      interactive: whatsappList({
        body: plain(s.m.catalogHeader),
        buttonLabel: plain(s.m.openCatalogBtn),
        sections: [
          {
            title: plain(s.m.catalog),
            rows: page.map((p, i) => ({
              id: `PROD:${p.id}`,
              title: p.name,
              description: prices[i],
            })),
          },
          { title: "…", rows: buttons.map((b) => ({ id: b.payload!, title: b.title })) },
        ],
      }),
    });
    return;
  }
  await reply(
    s,
    `${lines.join("\n")}\n\n${s.locale === "ru" ? "Напишите номер товара, чтобы посмотреть подробнее." : plain(s.m.searchPrompt)}`,
    { force, buttons: buttons.slice(0, 3) },
  );
}

/** Список WhatsApp вмещает десять строк с навигацией; в Instagram — нумерованный текст. */
function pageSize(s: Shop): number {
  return s.platform === "whatsapp" ? WA_LIST_PAGE : PAGE;
}

/** Шаг сценария списком WhatsApp: строки «STEP:<n>» разбираются как набранная цифра. */
function stepList(body: string, buttonLabel: string, section: string, titles: string[]): Json {
  return whatsappList({
    body,
    buttonLabel,
    sections: [
      { title: section, rows: titles.map((title, i) => ({ id: `${STEP_PREFIX}${i + 1}`, title })) },
    ],
  });
}

/** Номер: из показанного списка, иначе — номер товара из названия/ключевых слов, иначе поиск. */
async function pickByNumber(s: Shop, number: string) {
  const mem = memory(s.customer);
  const list = mem.list;
  const listFresh = list && Date.now() - Date.parse(list.at) < LIST_TTL_MS;
  const n = Number(number);
  if (listFresh && list.kind !== "variants" && n >= 1 && n <= list.ids.length) {
    const id = list.ids[n - 1]!;
    if (list.kind === "categories") return showCatalog(s, id, 0, true);
    const p = await getProduct(s.ctx, id);
    if (p) return sendProductCard(s, p, true);
  }
  // Номер из поста: «018. Набор …» — ищем по началу названия и по ключевым словам.
  const padded = Array.from(new Set([number, number.padStart(2, "0"), number.padStart(3, "0")]));
  const candidates: Product[] = [];
  for (const q of padded) {
    for (const p of await searchProducts(s.ctx, q, 30)) {
      if (
        productNumberFromName(p.name) === number ||
        productNumberFromKeywords(p.keywords) === number
      )
        candidates.push(p);
    }
    if (candidates.length) break;
  }
  const p = candidates[0];
  if (p) return sendProductCard(s, p, true);
  await reply(s, `${plain(s.m.productNotFound)}\n\n${hint(s)}`, {
    buttons: [BTN.catalog(s.m), BTN.cart(s.m)],
  });
}

async function sendProductCard(s: Shop, p: Product, force: boolean) {
  const country = s.customer.state.country_code ?? null;
  const variants = sortedVariants(p);
  const imgs = sortedImages(p);
  const outOfStock =
    s.ctx.tenant.modules.stock && p.stock_quantity != null && p.stock_quantity <= 0;
  const desc = p.description ? `\n\n${p.description.slice(0, 600)}` : "";
  let text = `${p.name}${desc}`;
  const buttons: DmButton[] = [];
  let variantList: string[] = [];
  if (variants.length > 0) {
    const priced = await Promise.all(
      variants.map(async (v) => ({ v, money: await resolvePrice(s.ctx, p, country, v) })),
    );
    const min = Math.min(...priced.map((r) => r.money.amount));
    const currency = priced[0]?.money.currency ?? p.currency;
    text += `\n\n${plain(s.m.priceFrom(formatMoney(min, currency)))}`;
    if (!outOfStock) {
      if (priced.length <= 2) {
        for (const { v, money } of priced)
          buttons.push({
            type: "postback",
            title: `${v.name} — ${formatMoney(money.amount, money.currency)}`.slice(0, 20),
            payload: `BUY:${p.id}:${v.id}`,
          });
      } else {
        variantList = priced.map(
          ({ v, money }, i) => `${i + 1}. ${v.name} — ${formatMoney(money.amount, money.currency)}`,
        );
        text += `\n\n${variantList.join("\n")}\n\n${s.locale === "ru" ? "Напишите номер варианта." : plain(s.m.chooseSection)}`;
      }
    }
  } else {
    const money = await resolvePrice(s.ctx, p, country);
    text += `\n\n${formatMoney(money.amount, money.currency)}`;
    if (!outOfStock)
      buttons.push({ type: "postback", title: plain(s.m.addToCartBtn), payload: `BUY:${p.id}` });
  }
  if (outOfStock && s.ctx.tenant.modules.waitlist)
    buttons.push({
      type: "postback",
      title: plain(s.m.waitlistBtn).slice(0, 20),
      payload: `WAIT:${p.id}`,
    });
  if (p.lead_time_days && p.lead_time_days > 0)
    text += `\n${plain(s.m.leadTimeLabel(p.lead_time_days))}`;
  const rating = s.ctx.tenant.modules.review_request
    ? formatRatingSummary(p.rating_avg, p.rating_count ?? 0)
    : null;
  if (rating) text += `\n${plain(rating)}`;
  if (outOfStock) text += `\n${plain(s.m.outOfStockLabel)}`;
  else if (s.ctx.tenant.modules.limited_offers) {
    const { offerForProduct, offerLabel } = await import("@/core/offers/offers");
    const offer = await offerForProduct(s.ctx, p.id);
    if (offer) text += `\n${offerLabel(offer, s.ctx.timezone, s.locale)}`;
  }
  buttons.push(BTN.cart(s.m));
  if (buttons.length < 3) buttons.push(BTN.catalog(s.m));

  if (variantList.length) {
    await remember(
      s,
      {
        variant_product: p.id,
        list: { kind: "variants", ids: variants.map((v) => v.id), at: new Date().toISOString() },
      },
      { mode: "awaiting_variant_choice" },
    );
  }
  const attachmentUrl = imgs[0] ? imageUrl(s.ctx, imgs[0].image_path) : undefined;
  await reply(s, text, { force, buttons: buttons.slice(0, 3), attachmentUrl });
}

// ── корзина ───────────────────────────────────────────────────────────

async function addAndShowCart(s: Shop, productId: string, variantId: string | null) {
  const r = await addToCart(s.ctx, s.customer, productId, variantId);
  const msg: Record<typeof r, string> = {
    ok: s.m.added,
    unavailable: s.m.unavailable,
    mixed_cart: s.m.mixedCart,
    digital_limit: s.m.digitalLimit,
    out_of_stock: s.m.outOfStock,
    error: s.m.unavailable,
  };
  if (r !== "ok") {
    await reply(s, msg[r], { force: true, buttons: [BTN.cart(s.m), BTN.catalog(s.m)] });
    return;
  }
  await showCart(s, true, plain(s.m.added));
}

async function showCart(s: Shop, force: boolean, prefix?: string) {
  const items = await listCart(s.ctx, s.customer);
  if (items.length === 0) {
    await reply(s, s.m.cartEmpty, { force, buttons: [BTN.catalog(s.m)] });
    return;
  }
  const st = s.customer.state;
  const priced = await priceCart(s.ctx, items, st.country_code ?? null);
  const sum = await cartSummary(s.ctx, s.customer, priced, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
  });
  let text = `${prefix ? `${prefix}\n\n` : ""}${plain(s.m.cartHeader)}`;
  priced.lines.forEach((line, i) => {
    text += `${i + 1}. ${line.name} × ${line.item.quantity} — ${formatMoney(line.line, priced.currency)}\n`;
  });
  if (sum.promo) text += plain(s.m.discountLine(formatMoney(sum.promo.discount, sum.currency)));
  if (sum.points.balance > 0) text += plain(s.m.pointsBalanceLine(sum.points.balance));
  if (sum.gift)
    text += plain(s.m.giftCertificateDiscountLine(formatMoney(sum.gift.discount, sum.currency)));
  text += plain(s.m.total(formatMoney(sum.total, sum.currency)));
  if (s.locale === "ru") text += "\n\nУбрать позицию: «убрать 1».";
  await reply(s, text, { force, buttons: [BTN.checkout(s.m), BTN.catalog(s.m), BTN.clear(s.m)] });
  if (s.ctx.tenant.modules.upsell) {
    const { upsellFor } = await import("@/core/upsell/upsell");
    const offers = await upsellFor(
      s.ctx,
      priced.lines.map((l) => l.item.products?.id).filter((x): x is string => Boolean(x)),
    );
    if (offers.length) {
      const lines: string[] = [];
      for (const o of offers) {
        const money = await resolvePrice(s.ctx, o, st.country_code ?? null);
        lines.push(`• ${o.name} — ${formatMoney(money.amount, money.currency)}`);
      }
      await reply(s, `${plain(s.m.upsellHeader)}\n${lines.join("\n")}`, {
        force: true,
        buttons: offers.map((o) => ({
          type: "postback" as const,
          title: `➕ ${o.name}`.slice(0, 20),
          payload: `BUY:${o.id}`,
        })),
      });
    }
  }
}

async function removeFromCart(s: Shop, number: string) {
  const items = await listCart(s.ctx, s.customer);
  const idx = pickCartLineToRemove(
    number,
    items.map((i) => i.products?.name ?? ""),
  );
  if (idx === null) {
    await showCart(s, true);
    return;
  }
  await removeCartItem(s.ctx, s.customer, items[idx]!.id);
  await showCart(s, true);
}

// ── оформление ────────────────────────────────────────────────────────

async function askLocale(s: Shop) {
  await setMode(s, { mode: "awaiting_locale" });
  if (s.platform === "whatsapp") {
    const body = "Выберите язык / Тілді таңдаңыз / Tilni tanlang / Choose language";
    await reply(s, body, {
      force: true,
      interactive: stepList(
        body,
        "Язык / Language",
        "Язык / Language",
        SUPPORTED_LOCALES.map((l) => `${flags[l]} ${localeNames[l]}`),
      ),
    });
    return;
  }
  await reply(s, languagePickerText(), { force: true });
}

async function askCountry(s: Shop, forCheckout: boolean) {
  const methods = await listActivePaymentMethods(s.ctx);
  if (methods.length === 0) {
    await reply(s, s.m.paymentNotConfigured);
    return;
  }
  await setMode(s, { mode: "awaiting_country", placing_order: forCheckout ? true : undefined });
  const lines = methods.map((m, i) => `${i + 1}. ${m.country_name}`);
  if (s.platform === "whatsapp" && methods.length <= WA_LIST_MAX_ROWS) {
    await reply(s, plain(s.m.chooseCountry), {
      force: true,
      interactive: stepList(
        plain(s.m.chooseCountry),
        s.locale === "ru" ? "Выбрать страну" : plain(s.m.chooseCountry).slice(0, 20),
        plain(s.m.chooseCountry),
        methods.map((m) => m.country_name),
      ),
    });
    return;
  }
  await reply(s, `${plain(s.m.chooseCountry)}\n\n${lines.join("\n")}`, { force: true });
}

async function startCheckout(s: Shop) {
  if ((await cartCount(s.ctx, s.customer)) === 0) {
    await reply(s, s.m.cartEmpty, { force: true, buttons: [BTN.catalog(s.m)] });
    return;
  }
  await continueCheckout(s);
}

async function continueCheckout(s: Shop) {
  const items = await listCart(s.ctx, s.customer);
  const physical = items.some((i) => i.products?.fulfillment_kind === "physical");
  // Телефон нужен только для физического заказа: цифровой выдаётся сюда же, в переписку.
  if (physical && !s.customer.contactPhone) {
    await setMode(s, { mode: "awaiting_contact" });
    await reply(s, s.m.phonePromptHtml, { force: true });
    return;
  }
  if (!s.customer.state.country_code) return askCountry(s, true);
  return proceedToFulfillmentOrPlace(s, s.customer.state.country_code);
}

async function proceedToFulfillmentOrPlace(s: Shop, countryCode: string) {
  const items = await listCart(s.ctx, s.customer);
  const physical = items.some((i) => i.products?.fulfillment_kind === "physical");
  const {
    checkout_fulfillment_type: _t,
    checkout_fulfillment_at: _a,
    checkout_delivery_zone_id: _z,
    checkout_delivery_zone_name: _zn,
    checkout_delivery_fee: _zf,
    checkout_fulfillment_address: _ad,
    checkout_fulfillment_note: _n,
    ...clean
  } = s.customer.state;
  if (!physical) {
    s.customer = await setState(s.ctx, s.customer, clean);
    return proceedToLanguageOrPlace(s, countryCode);
  }
  const fs = await fulfillmentSettings(s.ctx);
  if (fs.pickup && fs.delivery) {
    s.customer = await setState(s.ctx, s.customer, { ...clean, mode: "awaiting_fulfillment_type" });
    await reply(s, s.m.fulfillmentTypePrompt, {
      force: true,
      buttons: [
        { type: "postback", title: plain(s.m.fulfillmentTypePickupBtn), payload: "FT:pickup" },
        { type: "postback", title: plain(s.m.fulfillmentTypeDeliveryBtn), payload: "FT:delivery" },
      ],
    });
    return;
  }
  s.customer = await setState(s.ctx, s.customer, {
    ...clean,
    checkout_fulfillment_type: fs.delivery ? "delivery" : "pickup",
  });
  return askFulfillmentDate(s);
}

async function askFulfillmentDate(s: Shop) {
  const minDays = await maxLeadTimeDaysInCart(s.ctx, s.customer);
  const minIso = addDaysToIso(todayInTz(s.ctx.timezone), minDays);
  await setMode(s, { mode: "awaiting_fulfillment_date", checkout_min_fulfillment_date: minIso });
  await reply(s, s.m.fulfillmentDatePrompt(isoToDisplay(minIso)), { force: true });
}

async function afterDate(s: Shop) {
  if (s.customer.state.checkout_fulfillment_type === "delivery") return askZoneOrAddress(s);
  return askNote(s);
}

async function askZoneOrAddress(s: Shop) {
  const zones = await activeDeliveryZones(s.ctx);
  if (zones.length === 0) {
    await setMode(s, { mode: "awaiting_address" });
    await reply(s, s.m.addressPrompt, { force: true });
    return;
  }
  await setMode(s, { mode: "awaiting_delivery_zone" });
  const lines = await Promise.all(
    zones.map(async (z, i) => {
      const fee = await zoneFee(s.ctx, z.price, s.customer.state.country_code);
      return `${i + 1}. ${z.name} (+${formatMoney(fee.amount, fee.currency)})`;
    }),
  );
  await reply(s, `${plain(s.m.deliveryZonePrompt)}\n\n${lines.join("\n")}`, { force: true });
}

async function pickZone(s: Shop, zoneId: string) {
  const zone = (await activeDeliveryZones(s.ctx)).find((z) => z.id === zoneId);
  if (!zone) return askZoneOrAddress(s);
  const fee = await zoneFee(s.ctx, zone.price, s.customer.state.country_code);
  await setMode(s, {
    checkout_delivery_zone_id: zone.id,
    checkout_delivery_zone_name: zone.name,
    checkout_delivery_fee: fee.amount,
    mode: "awaiting_address",
  });
  await reply(s, s.m.addressPrompt, { force: true });
}

async function askNote(s: Shop) {
  await setMode(s, { mode: "awaiting_fulfillment_note" });
  await reply(s, s.m.fulfillmentNotePrompt, {
    force: true,
    buttons: [{ type: "postback", title: plain(s.m.fulfillmentNoteSkipBtn), payload: "NOTE:skip" }],
  });
}

async function finishAfterNote(s: Shop, note: string | null) {
  await setMode(s, { checkout_fulfillment_note: note ?? undefined, mode: "idle" });
  const cc = s.customer.state.country_code;
  if (!cc) return askCountry(s, true);
  return finishCheckout(s, cc);
}

/** Язык материалов до оформления — списком: языки корзины, затем «все языки ×N». */
async function proceedToLanguageOrPlace(s: Shop, countryCode: string) {
  if (await askDeliveryLangBeforeOrder(s.ctx)) {
    const langs = await cartLanguageChoices(s.ctx, s.customer);
    if (langs.length > 1) {
      await setMode(s, { mode: "awaiting_delivery_lang", delivery_lang: undefined });
      const titles = langs.map((l) => `${flags[l]} ${localeNames[l]}`);
      titles.push(plain(s.m.allLanguagesBtn(langs.length)));
      if (s.platform === "whatsapp") {
        await reply(s, plain(s.m.chooseDeliveryLanguage), {
          force: true,
          interactive: stepList(
            plain(s.m.chooseDeliveryLanguage),
            plain(s.m.chooseDeliveryLanguage),
            plain(s.m.chooseDeliveryLanguage),
            titles,
          ),
        });
        return;
      }
      const lines = titles.map((t, i) => `${i + 1}. ${t}`);
      await reply(s, `${plain(s.m.chooseDeliveryLanguage)}\n\n${lines.join("\n")}`, {
        force: true,
      });
      return;
    }
  }
  return finishCheckout(s, countryCode);
}

/**
 * Шаг «ваша почта» до оформления (перенос из v1): заказ из Instagram
 * выдаётся письмом, и почта нужна до чека — автопроверка чека выдаёт заказ
 * сразу. Спросили — true, оформление продолжит ответ покупателя.
 */
async function askEmailFirst(s: Shop, countryCode: string): Promise<boolean> {
  const items = await listCart(s.ctx, s.customer);
  const step = emailStep({
    platform: s.platform,
    physical: items.some((i) => i.products?.fulfillment_kind === "physical"),
    knownEmail: s.customer.email,
    skipped: memory(s.customer).email_skipped === true,
    mailReady: (s.transport.mailReady ?? isMailConfigured)(),
  });
  if (!step) return false;
  await setMode(s, { mode: "awaiting_email", country_code: countryCode });
  if (step === "required") await reply(s, s.m.emailAsk, { force: true });
  else
    await reply(s, s.m.emailAskOptional, {
      force: true,
      buttons: [{ type: "postback", title: plain(s.m.emailSkipBtn), payload: "EMAIL:skip" }],
    });
  return true;
}

/**
 * Почта, присланная после чека: в покупателя и в заказ. Если продавец уже
 * выдал заказ — письмо уходит сразу, иначе его отправит выдача.
 */
async function saveOrderEmail(s: Shop, orderId: number, email: string) {
  try {
    if (orderId) await setOrderEmail(s.ctx, orderId, s.customer.telegramId, email);
    s.customer = await setEmail(s.ctx, s.customer, email);
  } catch (e) {
    // Не говорим «записал», если не записали: шаг остаётся, покупатель пришлёт почту ещё раз.
    console.error(`[zernio:${s.ctx.tenant.id}] почта заказа #${orderId}: ${String(e)}`);
    await reply(s, s.m.emailSaveFailed, { force: true });
    return;
  }
  await setMode(s, { mode: "idle" });
  if (orderId) {
    const fresh = await getOrder(s.ctx, orderId);
    if (fresh?.status === "delivered") {
      const { emailOrderMaterials } = await import("@/core/orders/email");
      await emailOrderMaterials(s.ctx, fresh).catch((e) =>
        console.warn(`[zernio] письмо по заказу #${orderId}: ${String(e)}`),
      );
    }
  }
  await reply(s, s.m.emailSaved(email), { force: true });
}

/** После чека: заказу из Instagram без почты — спросить её (заказ мог прийти из v1 или до шага). */
async function askOrderEmailIfMissing(s: Shop, order: OrderWithItems): Promise<boolean> {
  if (
    s.platform !== "instagram" ||
    order.fulfillment_kind === "physical" ||
    order.customer_email?.trim() ||
    !(s.transport.mailReady ?? isMailConfigured)()
  )
    return false;
  await setMode(s, { mode: "awaiting_order_email", pending_order_id: order.id });
  return true;
}

async function finishCheckout(s: Shop, countryCode: string) {
  if (await askEmailFirst(s, countryCode)) return;
  const st = s.customer.state;
  const result = await placeOrder(s.ctx, s.customer, countryCode, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
    deliveryLang: isDeliveryLangChoice(st.delivery_lang) ? st.delivery_lang : null,
    fulfillment: st.checkout_fulfillment_type
      ? {
          type: st.checkout_fulfillment_type,
          at: st.checkout_fulfillment_at ?? null,
          address: st.checkout_fulfillment_address ?? null,
          note: st.checkout_fulfillment_note ?? null,
          zone: st.checkout_delivery_zone_id
            ? {
                id: st.checkout_delivery_zone_id,
                name: st.checkout_delivery_zone_name ?? "",
                fee: st.checkout_delivery_fee ?? 0,
              }
            : null,
        }
      : null,
  });
  if (!result.ok) {
    switch (result.reason) {
      case "busy":
        return void (await reply(s, s.m.checkoutBusy));
      case "empty_cart":
        return void (await reply(s, s.m.cartEmpty, { buttons: [BTN.catalog(s.m)] }));
      case "country_unavailable":
        await reply(s, s.m.countryNoLongerAvailable, { force: true });
        return askCountry(s, true);
      case "promo_invalid": {
        const { promo_code: _pc, ...rest } = st;
        s.customer = await setState(s.ctx, s.customer, rest);
        return void (await reply(s, s.m.promoCodeInvalid));
      }
      case "gift_invalid": {
        const { gift_certificate_code: _gc, ...rest } = st;
        s.customer = await setState(s.ctx, s.customer, rest);
        return void (await reply(s, s.m.giftCertificateInvalid));
      }
      case "out_of_stock":
        return void (await reply(s, s.m.outOfStockAtCheckout));
      default:
        return void (await reply(s, s.m.orderCreateFailed));
    }
  }
  const { order, method } = result;
  const no = displayNo(order);
  const {
    placing_order: _p,
    promo_code: _promo,
    use_points: _up,
    gift_certificate_code: _gift,
    checkout_fulfillment_type: _ft,
    checkout_fulfillment_at: _fa,
    checkout_min_fulfillment_date: _fm,
    checkout_delivery_zone_id: _fz,
    checkout_delivery_zone_name: _fzn,
    checkout_delivery_fee: _ff,
    checkout_fulfillment_address: _fad,
    checkout_fulfillment_note: _fn,
    delivery_lang: _dl,
    ...rest
  } = s.customer.state;
  const physical = order.fulfillment_kind === "physical";
  const api = adminTelegramApi(s.ctx);
  const notifyAdmin = async (
    o: OrderWithItems,
    opts: Parameters<typeof import("@/channels/telegram/admin-notify").notifyAdminNewOrder>[4] = {},
  ) => {
    if (!api) return;
    const { notifyAdminNewOrder } = await import("@/channels/telegram/admin-notify");
    await notifyAdminNewOrder(s.ctx, api, o, null, opts);
  };
  if (physical && result.amountDue <= 0 && !result.zeroTotal) {
    await s.ctx.db
      .from("orders")
      .update({ status: "accepted" })
      .eq("id", order.id)
      .eq("status", "awaiting_payment");
    s.customer = await setState(s.ctx, s.customer, { ...rest, mode: "idle" });
    await reply(s, s.m.orderAcceptedOnReceipt(no, formatMoney(order.total, order.currency)), {
      force: true,
    });
    await notifyAdmin(order);
    return;
  }
  if (result.zeroTotal) {
    s.customer = await setState(s.ctx, s.customer, { ...rest, mode: "idle" });
    await reply(s, s.m.orderPaidByDiscounts(no), { force: true });
    if (physical) {
      await s.ctx.db
        .from("orders")
        .update({ status: "accepted" })
        .eq("id", order.id)
        .eq("status", "awaiting_payment");
    } else {
      await deliverHere(s, order.id, no);
    }
    await notifyAdmin(order);
    return;
  }
  const due = result.amountDue;
  const rk = await robokassaFor(s.ctx);
  if (rk.ready) {
    s.customer = await setState(s.ctx, s.customer, {
      ...rest,
      mode: "choose_pay",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await reply(
      s,
      `${plain(s.m.manualTitleNew(no))}\n\n${plain(s.m.amountToPay(formatMoney(due, order.currency)))}\n\n${plain(s.m.choosePayMethod)}`,
      {
        force: true,
        buttons: [
          { type: "postback", title: plain(s.m.payViaRobokassaBtn), payload: "PAY:rk" },
          { type: "postback", title: plain(s.m.payManualBtn), payload: "PAY:manual" },
        ],
      },
    );
    return;
  }
  s.customer = await setState(s.ctx, s.customer, {
    ...rest,
    mode: "awaiting_proof",
    pending_order_id: order.id,
    pending_display_no: no,
  });
  const depositLine =
    physical && due < Number(order.total)
      ? `${plain(s.m.depositLine(formatMoney(due, order.currency), formatMoney(order.total, order.currency)))}\n\n`
      : "";
  await sendManualInstructions(s, {
    no,
    due,
    currency: order.currency,
    instructions: method.instructions,
    qr: method.qr_code_path,
    physical,
    depositLine,
  });
}

async function sendManualInstructions(
  s: Shop,
  p: {
    no: number;
    due: number;
    currency: string;
    instructions: string | null;
    qr: string | null;
    physical: boolean;
    depositLine: string;
  },
) {
  const text =
    `${plain(s.m.manualTitleNew(p.no))}\n\n${plain(s.m.amountToPay(formatMoney(p.due, p.currency)))}\n${p.depositLine}\n` +
    `${p.instructions || plain(s.m.defaultInstructions)}\n\n${plain(p.physical ? s.m.afterProofPhysical : s.m.afterProofManual)}`;
  await reply(s, text, { force: true, attachmentUrl: p.qr ? imageUrl(s.ctx, p.qr) : undefined });
}

async function choosePayment(s: Shop, kind: "rk" | "manual") {
  const orderId = Number(s.customer.state.pending_order_id);
  const order = orderId ? await getOrder(s.ctx, orderId) : null;
  if (!order || order.telegram_id !== s.customer.telegramId || order.status !== "awaiting_payment")
    return;
  const no = displayNo(order);
  const due = await amountDueNow(s.ctx, {
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  if (kind === "rk") {
    const rk = await robokassaFor(s.ctx);
    if (!rk.ready) return;
    const url = buildPaymentUrl(rk, {
      outSum: due,
      invId: order.id,
      description: `Заказ #${no}`,
      botId: s.ctx.tenant.id,
    });
    await setMode(s, {
      mode: "awaiting_payment",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await reply(
      s,
      `${plain(s.m.manualTitleNew(no))}\n\n${plain(s.m.amountToPay(formatMoney(due, order.currency)))}\n\n${plain(s.m.robokassaHint)}\n\n${url}`,
      { force: true, buttons: [{ type: "url", title: plain(s.m.payViaRobokassaBtn), url }] },
    );
    return;
  }
  const method =
    (await listActivePaymentMethods(s.ctx)).find((x) => x.country_code === order.country_code) ??
    null;
  const physical = order.fulfillment_kind === "physical";
  await setMode(s, { mode: "awaiting_proof", pending_order_id: order.id, pending_display_no: no });
  await sendManualInstructions(s, {
    no,
    due,
    currency: order.currency,
    instructions: method?.instructions ?? null,
    qr: method?.qr_code_path ?? null,
    physical,
    depositLine:
      physical && due < Number(order.total)
        ? `${plain(s.m.depositLine(formatMoney(due, order.currency), formatMoney(order.total, order.currency)))}\n\n`
        : "",
  });
}

// ── чек и выдача ──────────────────────────────────────────────────────

async function receiveProof(s: Shop, url: string, orderId: number) {
  const file = await (s.transport.download ?? downloadAttachment)(url, s.accountId);
  if (!file) {
    await reply(s, s.m.proofFailed, { force: true });
    return;
  }
  const mime = file.mime.split(";")[0]!.trim().toLowerCase();
  const ext =
    mime === "application/pdf"
      ? "pdf"
      : mime === "image/png"
        ? "png"
        : mime.startsWith("image/")
          ? "jpg"
          : "bin";
  const res = await attachPaymentProof(s.ctx, orderId, { bytes: file.bytes, mime, ext });
  if (!res.ok) {
    const text =
      res.reason === "duplicate"
        ? s.m.proofDuplicate
        : res.reason === "closed" || res.reason === "not_found"
          ? s.m.proofOrderClosed
          : res.reason === "invalid_file"
            ? s.m.proofBadFile
            : res.reason === "file_too_large"
              ? s.m.proofTooLarge
              : s.m.proofFailed;
    await reply(s, text, { force: true });
    return;
  }
  const no = displayNo(res.order);
  const api = adminTelegramApi(s.ctx);
  const { notifyAdminNewOrder } = await import("@/channels/telegram/admin-notify");
  const notifyAdmin = async (
    o: OrderWithItems,
    opts: Parameters<typeof notifyAdminNewOrder>[4] = {},
  ) => {
    if (api) await notifyAdminNewOrder(s.ctx, api, o, null, { ...opts, proofUrl: url });
  };

  const { receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
  if (res.order.fulfillment_kind !== "physical" && (await receiptOcrAutoEnabled(s.ctx))) {
    const { verifyReceipt } = await import("@/core/receipts/verify.server");
    const { isRetryReason } = await import("@/core/receipts/pure");
    const v = await verifyReceipt(s.ctx, {
      bytes: file.bytes,
      mime,
      expectedAmount: Number(res.order.total),
      currency: res.order.currency,
      orderId,
    });
    if (!v.ok && isRetryReason(v.reason)) {
      await s.ctx.db
        .from("orders")
        .update({ status: "awaiting_payment", admin_note: `OCR: ${v.detail}`.slice(0, 500) })
        .eq("id", orderId)
        .eq("status", "awaiting_confirmation");
      await reply(
        s,
        v.reason === "payment_failed"
          ? s.m.receiptPaymentFailed(String(no))
          : s.m.notReceiptLike(String(no)),
        { force: true },
      );
      return;
    }
    await setMode(s, { mode: "idle" });
    if (!v.ok) {
      await s.ctx.db
        .from("orders")
        .update({ admin_note: `OCR: ${v.detail}`.slice(0, 500) })
        .eq("id", orderId);
      await reply(s, s.m.receiptManualReview(String(no)), { force: true });
      if (await askOrderEmailIfMissing(s, res.order)) await reply(s, s.m.emailAsk, { force: true });
      await notifyAdmin(res.order, { reviewReason: v.detail });
      return;
    }
    await s.ctx.db
      .from("orders")
      .update({
        admin_note: `OCR ok: сумма ${v.matchedAmount}${v.matchedCurrency ? ` ${v.matchedCurrency} (по курсу)` : ""}`,
      })
      .eq("id", orderId);
    await reply(s, s.m.receiptVerified(String(no)), { force: true });
    const delivered = await deliverHere(s, orderId, no);
    const fresh = (await getOrder(s.ctx, orderId)) ?? res.order;
    if (await askOrderEmailIfMissing(s, fresh)) await reply(s, s.m.emailAsk, { force: true });
    await notifyAdmin(fresh, { autoDelivered: delivered });
    return;
  }

  await setMode(s, { mode: "idle" });
  if (await askOrderEmailIfMissing(s, res.order)) {
    await reply(s, s.m.proofReceivedNeedEmail(no), { force: true });
    await notifyAdmin(res.order);
    return;
  }
  const email =
    orderChannel(res.order.platform) !== "telegram" ? res.order.customer_email?.trim() : null;
  await reply(s, email ? s.m.proofReceivedEmail(no, email) : s.m.proofReceived(no), {
    force: true,
    buttons: [BTN.orders(s.m), BTN.catalog(s.m)],
  });
  await notifyAdmin(res.order);
}

/** Выдача цифрового заказа ссылками в эту же переписку. */
async function deliverHere(s: Shop, orderId: number, no: number): Promise<boolean> {
  const r = await deliverOrder(
    s.ctx,
    orderId,
    zernioMaterialSender(s.transport, s.conversationId, s.accountId, s.platform),
    // Direct не умеет спросить язык после оплаты — при нескольких языках отдаём все.
    { lang: s.locale, allWhenAmbiguous: true },
  );
  if (r.failed === 0 && !r.alreadyDelivered) {
    const { deliveredMessage } = await import("@/core/delivery/note.server");
    await reply(s, await deliveredMessage(s.ctx, s.platform, s.m.orderDelivered(no)), {
      force: true,
    });
  }
  if (r.failed > 0)
    await notifyDeliveryFailure(s.ctx, { id: orderId, display_no: no, order_no: no }, r);
  if (r.pointsEarned > 0) await reply(s, s.m.pointsEarned(r.pointsEarned), { force: true });
  if (r.referral) {
    const api = adminTelegramApi(s.ctx);
    if (api)
      await api.call("sendMessage", {
        chat_id: r.referral.telegramId,
        text: COPY.ru.referralReward(r.referral.percent, r.referral.code),
        parse_mode: "HTML",
      });
  }
  return r.failed === 0;
}

async function showOrders(s: Shop) {
  const orders = await listCustomerOrders(s.ctx, s.customer);
  if (orders.length === 0) {
    await reply(s, s.m.myOrdersEmpty, { force: true, buttons: [BTN.catalog(s.m)] });
    return;
  }
  let text = plain(s.m.myOrdersHeader);
  for (const o of orders.slice(0, 10)) {
    const no = displayNo(o);
    const st = s.m.status[o.status] ?? o.status;
    text += `#${no} — ${formatMoney(o.total, o.currency)} — ${plain(st)}\n`;
    for (const i of o.order_items ?? []) text += `   • ${i.name_snapshot} × ${i.quantity}\n`;
  }
  // Кнопок в Direct не больше трёх: «повторить» — для последнего закрытого заказа с товарами.
  const repeatable = orders.find(
    (o) =>
      ["delivered", "rejected", "cancelled"].includes(o.status) && (o.order_items ?? []).length,
  );
  const buttons: DmButton[] = [BTN.catalog(s.m), BTN.cart(s.m)];
  if (repeatable)
    buttons.push({
      type: "postback",
      title: `${plain(s.m.reorderBtn)} #${displayNo(repeatable)}`,
      payload: `REORDER:${repeatable.id}`,
    });
  await reply(s, text, { force: true, buttons });
}

export const __test = { fingerprint, env };
