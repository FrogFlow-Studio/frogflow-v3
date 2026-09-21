import { REFERRAL_PREFIX, registerReferral, type ReferralGrant } from "@/core/referrals/referrals";
import {
  hasDeliveredPurchase,
  reviewableProductsForOrder,
  saveComment,
  saveRating,
} from "@/core/reviews/reviews";
import { formatRatingSummary, isValidRating } from "@/core/reviews/pure";
import { inboundIntercepted } from "@/core/chat/chat";
import { PRODUCT_SELECT } from "@/core/catalog/catalog";
import { stateFromJson } from "@/core/customers/customers";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "./api";
import type {
  InlineButton,
  InlineKeyboard,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from "./types";
import {
  COPY,
  categoryButtonLabel,
  escapeHtml,
  menuActionFor,
  normalizePhone,
  type Msg,
} from "./copy";
import {
  isLocale,
  localeFlags,
  localeNames,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/core/i18n/locale";
import { verticalDef } from "@/core/verticals/registry";
import { formatMoney } from "@/core/money/money";
import {
  upsertCustomer,
  getCustomer,
  setState,
  setContactPhone,
  isBlocked,
  type Customer,
} from "@/core/customers/customers";
import {
  categoryParentId,
  getProduct,
  imageUrl,
  listChildCategories,
  listProductsInCategory,
  searchProducts,
  sortedImages,
  sortedVariants,
  type Product,
} from "@/core/catalog/catalog";
import { resolvePrice } from "@/core/pricing/pricing";
import {
  addToCart,
  cartCount,
  clearCart,
  listCart,
  priceCart,
  removeCartItem,
} from "@/core/cart/cart";
import {
  attachPaymentProof,
  cartSummary,
  deliverOrder,
  displayNo,
  getOrder,
  listActivePaymentMethods,
  listCustomerOrders,
  placeOrder,
  recentAwaitingPaymentOrder,
  rejectOrder,
} from "@/core/orders/orders";
import { getSetting } from "@/core/settings/settings";
import { shopAdminIds } from "@/core/notify/recipients";
import { notifyAdminNewOrder } from "./admin-notify";
import { telegramMaterialSender } from "./deliver";
import { findValidGift, findValidPromoCode } from "@/core/discounts/discounts";
import { normalizeCode } from "@/core/discounts/pure";
import { claimHandoff, HANDOFF_PREFIX } from "@/core/storefront/handoff";
import { robokassaFor } from "@/core/payments/payment";
import { buildPaymentUrl } from "@/core/payments/robokassa";
import {
  activeDeliveryZones,
  fulfillmentSettings,
  maxLeadTimeDaysInCart,
  zoneFee,
} from "@/core/fulfillment/fulfillment";
import {
  addDaysToIso,
  isoToDisplay,
  matchFulfillmentType,
  parseDateInput,
  todayInTz,
} from "@/core/fulfillment/pure";

const PAGE = 5;
const DEFAULT_PAUSED = "Бот временно недоступен. Загляните чуть позже — мы уже разбираемся.";

/**
 * Адаптер Telegram: разбирает обновление, зовёт ядро, рисует ответ.
 * Ни одной бизнес-проверки здесь нет — они в core/*. Канал знает про
 * клавиатуры, HTML и file_id; ядро — про корзину, заказы и цены.
 */
export async function handleTelegramUpdate(
  ctx: TenantContext,
  api: TelegramApi,
  update: TelegramUpdate,
): Promise<void> {
  try {
    if (update.callback_query) return await handleCallback(ctx, api, update.callback_query);
    if (update.message) return await handleMessage(ctx, api, update.message);
  } catch (e) {
    console.error(`[tg:${ctx.tenant.id}] update failed`, e);
  }
}

type Bot = {
  ctx: TenantContext;
  api: TelegramApi;
  chatId: number;
  customer: Customer;
  locale: Locale;
  m: Msg;
};

function localeOf(ctx: TenantContext, customer: Customer): Locale {
  const fromState = customer.state.locale;
  if (isLocale(fromState)) return fromState;
  return ctx.tenant.settings.default_locale ?? "ru";
}

async function send(b: Bot, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  await b.api.call("sendMessage", {
    chat_id: b.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

function contactLabels(ctx: TenantContext): string[] {
  const def = verticalDef(ctx.tenant.vertical);
  return SUPPORTED_LOCALES.map((l) => def.locales[l].contactBtn);
}

function mainMenu(b: Bot) {
  const def = verticalDef(b.ctx.tenant.vertical);
  const m = b.m;
  const keyboard: Array<Array<Record<string, unknown>>> = [
    [{ text: m.catalog }, { text: m.search }],
    [{ text: m.cart }, { text: m.myOrders }],
    [{ text: m.instruction }, { text: m.information }],
    [{ text: def.locales[b.locale].contactBtn }],
  ];
  const t = b.ctx.tenant;
  if (t.modules.telegram_mini_app && t.modules.shop) {
    keyboard.unshift([
      { text: "🛍 Магазин", web_app: { url: `${b.ctx.appUrl}/s/${t.settings.slug ?? t.id}` } },
    ]);
  }
  return { keyboard, resize_keyboard: true };
}

async function sendMain(b: Bot, text?: string) {
  await send(b, text ?? b.m.chooseSection, { reply_markup: mainMenu(b) });
}

/** Показать корзину покупателю извне (Mini App перенёс позиции). */
export async function sendCartMessage(
  ctx: TenantContext,
  api: TelegramApi,
  customer: Customer,
): Promise<void> {
  const locale = localeOf(ctx, customer);
  await showCart({ ctx, api, chatId: customer.telegramId, customer, locale, m: COPY[locale] });
}

// ── входящие сообщения ────────────────────────────────────────────────

async function handleMessage(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<void> {
  const from = msg.from;
  if (!from || (msg.chat.type !== undefined && msg.chat.type !== "private")) return;
  const chatId = msg.chat.id;

  if (await isBlocked(ctx, from.id)) return;
  if (ctx.tenant.status !== "active") {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: ctx.tenant.pausedMessage?.trim() || DEFAULT_PAUSED,
    });
    return;
  }

  const customer = await upsertCustomer(ctx, "telegram", from.id, {
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
    languageCode: from.language_code,
  });
  const locale = localeOf(ctx, customer);
  const b: Bot = { ctx, api, chatId, customer, locale, m: COPY[locale] };
  const text = msg.text?.trim();

  // Чат с менеджером: реплика в лог; если менеджер подключён — бот молчит.
  // Исключения: /start (покупатель хочет меню) и чек на шаге оплаты.
  const proofStep = customer.state.mode === "awaiting_proof" && Boolean(msg.photo || msg.document);
  const intercepted = await inboundIntercepted(
    ctx,
    from.id,
    text ||
      msg.caption ||
      (msg.photo ? "[фото]" : msg.document ? "[файл]" : msg.contact ? "[контакт]" : "[без текста]"),
  );
  if (intercepted && !text?.startsWith("/start") && !proofStep) return;

  if (text?.startsWith("/start")) return startFlow(b, text.slice(6).trim());

  // Телефон на шаге оформления — кнопкой или текстом.
  if (customer.state.mode === "awaiting_contact") {
    const phone = msg.contact?.phone_number ?? (text ? normalizePhone(text) : null);
    const action = menuActionFor(text, contactLabels(ctx));
    if (!phone && !action) {
      await send(b, b.m.phoneInvalid);
      return;
    }
    if (phone) {
      b.customer = await setContactPhone(ctx, customer, phone);
      b.customer = await setState(ctx, b.customer, { ...b.customer.state, mode: "idle" });
      await send(b, b.m.contactSaved, { reply_markup: mainMenu(b) });
      return continueCheckout(b);
    }
  }

  // Чек оплаты: по состоянию либо по свежему открытому заказу.
  if (msg.photo || msg.document) {
    const proofModes = new Set(["awaiting_proof", "awaiting_payment"]);
    let orderId =
      proofModes.has(String(customer.state.mode)) && customer.state.pending_order_id
        ? Number(customer.state.pending_order_id)
        : null;
    if (!orderId) orderId = await recentAwaitingPaymentOrder(ctx, customer);
    if (orderId) return receiveProof(b, msg, orderId);
  }

  const action = menuActionFor(text, contactLabels(ctx));

  if (text && !action) {
    const mode = customer.state.mode;
    if (mode === "awaiting_fulfillment_type") {
      const type = matchFulfillmentType(text);
      if (!type) return void (await send(b, b.m.fulfillmentTypePrompt));
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        checkout_fulfillment_type: type,
      });
      return askFulfillmentDate(b);
    }
    if (mode === "awaiting_fulfillment_date") {
      const iso = parseDateInput(text);
      const minIso =
        customer.state.checkout_min_fulfillment_date ??
        addDaysToIso(todayInTz(ctx.timezone), await maxLeadTimeDaysInCart(ctx, customer));
      if (!iso) return void (await send(b, b.m.fulfillmentDateInvalid));
      if (iso < minIso)
        return void (await send(b, b.m.fulfillmentDateTooEarly(isoToDisplay(minIso))));
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        checkout_fulfillment_at: iso,
      });
      return afterDate(b);
    }
    if (mode === "awaiting_delivery_zone") {
      const zones = await activeDeliveryZones(ctx);
      const z =
        zones.find((x) => x.name.trim().toLowerCase() === text.trim().toLowerCase()) ??
        zones.find((x) => text.toLowerCase().includes(x.name.toLowerCase()));
      return z ? pickZone(b, z.id) : askZoneOrAddress(b);
    }
    if (mode === "awaiting_address") {
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        checkout_fulfillment_address: text.slice(0, 500),
      });
      return askNote(b);
    }
    if (mode === "awaiting_fulfillment_note") return finishAfterNote(b, text.slice(0, 500));
  }

  if (customer.state.mode === "awaiting_review_comment") {
    const { review_product_id: productId, ...rest } = customer.state;
    b.customer = await setState(ctx, customer, { ...rest, mode: "idle" });
    if (text && !action && productId) {
      await saveComment(ctx, from.id, productId, text);
      await send(b, b.m.reviewCommentSaved);
      return;
    }
  }
  if (customer.state.mode === "awaiting_promo_code" && text && !action) {
    const idle = { ...customer.state, mode: "idle" as const };
    const found = await findValidPromoCode(ctx, text);
    if (!found.ok) {
      b.customer = await setState(ctx, customer, idle);
      await send(b, b.m.promoCodeInvalid);
    } else {
      b.customer = await setState(ctx, customer, { ...idle, promo_code: normalizeCode(text) });
    }
    return showCart(b);
  }
  if (customer.state.mode === "awaiting_gift_certificate_code" && text && !action) {
    const idle = { ...customer.state, mode: "idle" as const };
    const found = await findValidGift(ctx, text);
    if (!found.ok) {
      b.customer = await setState(ctx, customer, idle);
      await send(b, b.m.giftCertificateInvalid);
    } else {
      b.customer = await setState(ctx, customer, {
        ...idle,
        gift_certificate_code: normalizeCode(text),
      });
    }
    return showCart(b);
  }

  if (customer.state.mode === "awaiting_proof" && customer.state.pending_order_id && !action) {
    await send(b, b.m.sendReceiptPrompt);
    return;
  }
  if (action) {
    if (customer.state.mode && customer.state.mode !== "idle") {
      b.customer = await setState(ctx, customer, { ...customer.state, mode: "idle" });
    }
    return menuAction(b, action);
  }
  if (customer.state.mode === "search" && text) return showSearch(b, text);
  await sendMain(b, b.m.useMenu);
}

async function startFlow(b: Bot, payload = "") {
  if (payload.startsWith(REFERRAL_PREFIX)) {
    const gift = await registerReferral(
      b.ctx,
      b.customer.telegramId,
      payload.slice(REFERRAL_PREFIX.length),
    );
    if (gift) await send(b, b.m.referralWelcome(gift.percent, gift.code));
    payload = "";
  }
  if (payload.startsWith(HANDOFF_PREFIX)) {
    const r = await claimHandoff(b.ctx, b.customer, payload.slice(HANDOFF_PREFIX.length));
    if (!b.customer.state.locale)
      await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
    if (r === "ok" || r === "claimed") return showCart(b);
    await send(b, b.m.cartEmpty);
    return;
  }
  if (payload.startsWith("p_")) {
    if (!b.customer.state.locale)
      await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
    const p = await getProduct(b.ctx, payload.slice(2));
    if (p) return sendProductCard(b, p);
  }
  if (b.ctx.tenant.modules.multi_language) {
    const buttons: InlineButton[][] = SUPPORTED_LOCALES.map((l) => [
      { text: `${localeFlags[l]} ${localeNames[l]}`, callback_data: `locale:${l}` },
    ]);
    await send(b, b.m.chooseLanguage, { reply_markup: { inline_keyboard: buttons } });
    return;
  }
  await applyLocale(b, b.ctx.tenant.settings.default_locale ?? "ru");
}

async function applyLocale(b: Bot, locale: Locale) {
  b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, locale, mode: "idle" });
  b.locale = locale;
  b.m = COPY[locale];
  const v = verticalDef(b.ctx.tenant.vertical).locales[locale];
  const shopName = (await getSetting(b.ctx, "shop_name")) ?? b.ctx.tenant.name;
  const welcome =
    `<b>${escapeHtml(shopName)}</b>\n${escapeHtml(v.welcomeGreeting)}\n\n` +
    `→ ${escapeHtml(v.welcomeCatalog)}\n→ ${escapeHtml(v.welcomePayment)}`;
  await sendMain(b, welcome);
}

async function menuAction(b: Bot, action: ReturnType<typeof menuActionFor>) {
  switch (action) {
    case "catalog":
      return showCategories(b, null, 0);
    case "search":
      b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "search" });
      await send(b, b.m.searchPrompt);
      return;
    case "cart":
      return showCart(b);
    case "myOrders":
      return showMyOrders(b);
    case "instruction": {
      const v = verticalDef(b.ctx.tenant.vertical).locales[b.locale];
      const caption =
        (await getSetting(b.ctx, "instruction_caption")) ??
        v.instructionDefaultCaption ??
        b.m.instructionDefault;
      await send(b, escapeHtml(caption));
      return;
    }
    case "information": {
      const base = `${b.ctx.appUrl}/s/${b.ctx.tenant.settings.slug ?? b.ctx.tenant.id}/legal`;
      const buttons: InlineButton[][] = [
        [
          { text: "📄 Оферта", url: `${base}/offer` },
          { text: "🔒 Конфиденциальность", url: `${base}/privacy` },
        ],
        [
          { text: "🏢 Реквизиты", url: `${base}/requisites` },
          { text: "ℹ️ О продавце", url: `${base}/about` },
        ],
      ];
      const botName = b.ctx.tenant.settings.telegram?.username;
      if (b.ctx.tenant.modules.referral && botName)
        buttons.push([
          {
            text: b.m.inviteFriendBtn,
            url: `https://t.me/${botName}?start=${REFERRAL_PREFIX}${b.customer.telegramId}`,
          },
        ]);
      await send(b, b.m.infoText, { reply_markup: { inline_keyboard: buttons } });
      return;
    }
    case "contact": {
      const link = await getSetting(b.ctx, "admin_contact_link");
      await send(b, link ? b.m.contactAuthor(escapeHtml(link)) : b.m.contactNotSet);
      return;
    }
  }
}

// ── каталог ───────────────────────────────────────────────────────────

async function backButton(b: Bot, parentId: string | null): Promise<InlineButton[] | null> {
  if (!parentId) return null;
  const up = await categoryParentId(b.ctx, parentId);
  return [{ text: b.m.back, callback_data: up ? `cat:${up}:0` : "cat:root:0" }];
}

async function showCategories(b: Bot, parentId: string | null, offset: number) {
  const [cats, products] = await Promise.all([
    listChildCategories(b.ctx, parentId),
    listProductsInCategory(b.ctx, parentId),
  ]);
  if (offset === 0 && cats.length > 0) {
    const rows: InlineButton[][] = cats.map((c) => [
      { text: categoryButtonLabel(c.name), callback_data: `cat:${c.id}:0` },
    ]);
    const back = await backButton(b, parentId);
    if (back) rows.push(back);
    await send(b, parentId ? b.m.subcategories : b.m.catalogHeader, {
      reply_markup: { inline_keyboard: rows },
    });
  }
  if (products.length === 0 && cats.length === 0) {
    if (offset === 0) {
      const back = await backButton(b, parentId);
      await send(b, b.m.emptyHere, back ? { reply_markup: { inline_keyboard: [back] } } : {});
    }
    return;
  }
  for (const p of products.slice(offset, offset + PAGE)) await sendProductCard(b, p);
  const nav: InlineButton[][] = [];
  if (offset + PAGE < products.length) {
    nav.push([{ text: b.m.showMore, callback_data: `cat:${parentId ?? "root"}:${offset + PAGE}` }]);
  }
  if (parentId && (cats.length === 0 || offset > 0)) {
    const back = await backButton(b, parentId);
    if (back) nav.push([{ ...back[0]!, text: b.m.backToCategories }]);
  }
  if (nav.length) await send(b, b.m.navigation, { reply_markup: { inline_keyboard: nav } });
}

async function sendProductCard(b: Bot, p: Product) {
  const country = b.customer.state.country_code ?? null;
  const imgs = sortedImages(p);
  const variants = sortedVariants(p);
  const desc = p.description ? `\n\n${escapeHtml(p.description)}` : `\n\n<i>${b.m.descPending}</i>`;
  const outOfStock =
    b.ctx.tenant.modules.stock && p.stock_quantity != null && p.stock_quantity <= 0;
  let caption: string;
  let keyboard: InlineKeyboard;
  if (variants.length > 0) {
    const priced = await Promise.all(
      variants.map(async (v) => ({ v, money: await resolvePrice(b.ctx, p, country, v) })),
    );
    const min = Math.min(...priced.map((r) => r.money.amount));
    const currency = priced[0]?.money.currency ?? p.currency;
    caption = `📦 <b>${escapeHtml(p.name)}</b>${desc}\n\n💰 <b>${b.m.priceFrom(formatMoney(min, currency))}</b>`;
    keyboard = {
      inline_keyboard: outOfStock
        ? []
        : priced.map(({ v, money }) => [
            {
              text: `${v.name} — ${formatMoney(money.amount, money.currency)}`,
              callback_data: `add:${p.id}:${v.id}`,
            },
          ]),
    };
  } else {
    const money = await resolvePrice(b.ctx, p, country);
    caption = `📦 <b>${escapeHtml(p.name)}</b>${desc}\n\n💰 <b>${formatMoney(money.amount, money.currency)}</b>`;
    keyboard = {
      inline_keyboard: outOfStock
        ? []
        : [[{ text: b.m.addToCartBtn, callback_data: `add:${p.id}` }]],
    };
  }
  if (p.lead_time_days && p.lead_time_days > 0)
    caption += `\n${b.m.leadTimeLabel(p.lead_time_days)}`;
  const rating = b.ctx.tenant.modules.review_request
    ? formatRatingSummary(p.rating_avg, p.rating_count ?? 0)
    : null;
  if (rating) caption += `\n${rating}`;
  if (outOfStock) caption += `\n${b.m.outOfStockLabel}`;
  if (imgs.length === 0) {
    await send(b, caption, { reply_markup: keyboard });
  } else {
    const res = await b.api.call("sendPhoto", {
      chat_id: b.chatId,
      photo: imageUrl(b.ctx, imgs[0]!.image_path),
      caption: caption.slice(0, 1024),
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    if (!res.ok) await send(b, caption, { reply_markup: keyboard });
  }
}

async function showSearch(b: Bot, query: string) {
  const found = await searchProducts(b.ctx, query);
  if (found.length === 0) {
    const smart = await smartSearchFallback(b, query);
    if (smart.length === 0) {
      await send(b, b.m.searchNothing(escapeHtml(query)));
      return;
    }
    await send(b, b.m.smartSearchResults(escapeHtml(query), smart.length));
    for (const p of smart.slice(0, PAGE)) await sendProductCard(b, p);
    return;
  }
  await send(b, b.m.searchResults(escapeHtml(query), found.length));
  for (const p of found.slice(0, PAGE)) await sendProductCard(b, p);
}

/** Умный поиск (LLM) — только когда обычный ничего не нашёл и продавец его включил. */
async function smartSearchFallback(b: Bot, query: string): Promise<Product[]> {
  const { smartSearchEnabled, consumeQuota, smartSearchProductIds } =
    await import("@/core/search/smart.server");
  if (!(await smartSearchEnabled(b.ctx))) return [];
  if (!(await consumeQuota(b.ctx, b.customer))) return [];
  const ids = await smartSearchProductIds(b.ctx, query);
  if (!ids?.length) return [];
  const { data } = await b.ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .in("id", ids.slice(0, PAGE))
    .eq("is_active", true);
  const byId = new Map(((data ?? []) as unknown as Product[]).map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
}

// ── корзина и оформление ──────────────────────────────────────────────

async function showCart(b: Bot) {
  const items = await listCart(b.ctx, b.customer);
  if (items.length === 0) {
    await send(b, b.m.cartEmpty);
    return;
  }
  const st = b.customer.state;
  const priced = await priceCart(b.ctx, items, st.country_code ?? null);
  const sum = await cartSummary(b.ctx, b.customer, priced, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
  });
  const mod = b.ctx.tenant.modules;
  let text = b.m.cartHeader;
  const buttons: InlineButton[][] = [];
  for (const line of priced.lines) {
    text += `• ${escapeHtml(line.name)} × ${line.item.quantity} — ${formatMoney(line.line, priced.currency)}\n`;
    buttons.push([{ text: b.m.removeItem(line.name), callback_data: `rem:${line.item.id}` }]);
  }
  if (sum.promo) text += b.m.discountLine(formatMoney(sum.promo.discount, sum.currency));
  if (sum.points.balance > 0) {
    text += b.m.pointsBalanceLine(sum.points.balance);
    if (sum.points.discount > 0)
      text += b.m.pointsDiscountLine(formatMoney(sum.points.discount, sum.currency));
  }
  if (sum.gift)
    text += b.m.giftCertificateDiscountLine(formatMoney(sum.gift.discount, sum.currency));
  text += b.m.total(formatMoney(sum.total, sum.currency));
  buttons.push([
    { text: b.m.checkoutBtn, callback_data: "checkout" },
    { text: b.m.clearBtn, callback_data: "clear" },
  ]);
  if (mod.coupons) {
    buttons.push([
      sum.promo
        ? { text: b.m.removePromoBtn, callback_data: "promo:clear" }
        : { text: b.m.promoCodeBtn, callback_data: "promo:enter" },
    ]);
  }
  if (mod.loyalty && sum.points.balance > 0) {
    buttons.push([
      sum.points.used
        ? { text: b.m.removePointsBtn, callback_data: "points:clear" }
        : { text: b.m.usePointsBtn, callback_data: "points:use" },
    ]);
  }
  if (mod.gift_certificates) {
    buttons.push([
      sum.gift
        ? { text: b.m.removeGiftCertificateBtn, callback_data: "giftcert:clear" }
        : { text: b.m.giftCertificateBtn, callback_data: "giftcert:enter" },
    ]);
  }
  await send(b, text.slice(0, 4096), { reply_markup: { inline_keyboard: buttons } });
}

async function askCountry(b: Bot, forCheckout: boolean) {
  const methods = await listActivePaymentMethods(b.ctx);
  if (methods.length === 0) {
    await send(b, b.m.paymentNotConfigured);
    return;
  }
  const prefix = forCheckout ? "country:" : "setcountry:";
  await send(b, b.m.chooseCountry, {
    reply_markup: {
      inline_keyboard: methods.map((m) => [
        { text: m.country_name, callback_data: `${prefix}${m.country_code}` },
      ]),
    },
  });
}

async function startCheckout(b: Bot) {
  if ((await cartCount(b.ctx, b.customer)) === 0) {
    await send(b, b.m.cartEmpty);
    return;
  }
  return continueCheckout(b);
}

async function continueCheckout(b: Bot) {
  if (!b.customer.contactPhone) {
    b.customer = await setState(b.ctx, b.customer, {
      ...b.customer.state,
      mode: "awaiting_contact",
    });
    await send(b, b.m.phonePromptHtml, {
      reply_markup: {
        keyboard: [[{ text: b.m.shareContactBtn, request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return;
  }
  if (!b.customer.state.country_code) return askCountry(b, true);
  return proceedToFulfillmentOrPlace(b, b.customer.state.country_code);
}

/** Физическая корзина: способ получения → дата → зона и адрес → пожелания → заказ. */
async function proceedToFulfillmentOrPlace(b: Bot, countryCode: string) {
  const items = await listCart(b.ctx, b.customer);
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
  } = b.customer.state;
  if (!physical) {
    b.customer = await setState(b.ctx, b.customer, clean);
    return finishCheckout(b, countryCode);
  }
  const fs = await fulfillmentSettings(b.ctx);
  if (fs.pickup && fs.delivery) {
    b.customer = await setState(b.ctx, b.customer, { ...clean, mode: "awaiting_fulfillment_type" });
    await send(b, b.m.fulfillmentTypePrompt, {
      reply_markup: {
        inline_keyboard: [
          [{ text: b.m.fulfillmentTypePickupBtn, callback_data: "fulfilltype:pickup" }],
          [{ text: b.m.fulfillmentTypeDeliveryBtn, callback_data: "fulfilltype:delivery" }],
        ],
      },
    });
    return;
  }
  b.customer = await setState(b.ctx, b.customer, {
    ...clean,
    checkout_fulfillment_type: fs.delivery ? "delivery" : "pickup",
  });
  return askFulfillmentDate(b);
}

async function askFulfillmentDate(b: Bot) {
  const minDays = await maxLeadTimeDaysInCart(b.ctx, b.customer);
  const minIso = addDaysToIso(todayInTz(b.ctx.timezone), minDays);
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    mode: "awaiting_fulfillment_date",
    checkout_min_fulfillment_date: minIso,
  });
  await send(b, b.m.fulfillmentDatePrompt(isoToDisplay(minIso)));
}

async function afterDate(b: Bot) {
  if (b.customer.state.checkout_fulfillment_type === "delivery") return askZoneOrAddress(b);
  return askNote(b);
}

async function askZoneOrAddress(b: Bot) {
  const zones = await activeDeliveryZones(b.ctx);
  if (zones.length === 0) {
    b.customer = await setState(b.ctx, b.customer, {
      ...b.customer.state,
      mode: "awaiting_address",
    });
    return void (await send(b, b.m.addressPrompt));
  }
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    mode: "awaiting_delivery_zone",
  });
  const buttons = await Promise.all(
    zones.map(async (z) => {
      const fee = await zoneFee(b.ctx, z.price, b.customer.state.country_code);
      return [
        {
          text: `${z.name} (+${formatMoney(fee.amount, fee.currency)})`,
          callback_data: `zone:${z.id}`,
        },
      ];
    }),
  );
  await send(b, b.m.deliveryZonePrompt, { reply_markup: { inline_keyboard: buttons } });
}

async function pickZone(b: Bot, zoneId: string) {
  const zone = (await activeDeliveryZones(b.ctx)).find((z) => z.id === zoneId);
  if (!zone) return askZoneOrAddress(b);
  const fee = await zoneFee(b.ctx, zone.price, b.customer.state.country_code);
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    checkout_delivery_zone_id: zone.id,
    checkout_delivery_zone_name: zone.name,
    checkout_delivery_fee: fee.amount,
    mode: "awaiting_address",
  });
  await send(b, b.m.addressPrompt);
}

async function askNote(b: Bot) {
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    mode: "awaiting_fulfillment_note",
  });
  await send(b, b.m.fulfillmentNotePrompt, {
    reply_markup: {
      inline_keyboard: [[{ text: b.m.fulfillmentNoteSkipBtn, callback_data: "fulfillnote:skip" }]],
    },
  });
}

async function finishAfterNote(b: Bot, note: string | null) {
  b.customer = await setState(b.ctx, b.customer, {
    ...b.customer.state,
    checkout_fulfillment_note: note ?? undefined,
    mode: "idle",
  });
  const cc = b.customer.state.country_code;
  if (!cc) return askCountry(b, true);
  return finishCheckout(b, cc);
}

async function finishCheckout(b: Bot, countryCode: string) {
  const st = b.customer.state;
  const result = await placeOrder(b.ctx, b.customer, countryCode, {
    promoCode: st.promo_code,
    usePoints: st.use_points,
    giftCode: st.gift_certificate_code,
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
        return void (await send(b, b.m.checkoutBusy));
      case "empty_cart":
        return void (await send(b, b.m.cartEmpty));
      case "country_unavailable":
        await send(b, b.m.countryNoLongerAvailable);
        return askCountry(b, true);
      case "promo_invalid": {
        const { promo_code: _pc, ...rest } = st;
        b.customer = await setState(b.ctx, b.customer, rest);
        return void (await send(b, b.m.promoCodeInvalid));
      }
      case "gift_invalid": {
        const { gift_certificate_code: _gc, ...rest } = st;
        b.customer = await setState(b.ctx, b.customer, rest);
        return void (await send(b, b.m.giftCertificateInvalid));
      }
      case "out_of_stock":
        return void (await send(b, b.m.outOfStockAtCheckout));
      default:
        return void (await send(b, b.m.orderCreateFailed));
    }
  }
  const { order, method } = result;
  const no = displayNo(order);
  // Промокод, баллы и сертификат — одноразовые: снимаем из состояния, чтобы
  // не прилипли к следующему заказу.
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
    ...rest
  } = b.customer.state;
  const physical = order.fulfillment_kind === "physical";
  if (physical && result.amountDue <= 0 && !result.zeroTotal) {
    // Оплата при получении: заказ сразу в работе.
    await b.ctx.db
      .from("orders")
      .update({ status: "accepted" })
      .eq("id", order.id)
      .eq("status", "awaiting_payment");
    b.customer = await setState(b.ctx, b.customer, { ...rest, mode: "idle" });
    await send(b, b.m.orderAcceptedOnReceipt(no, formatMoney(order.total, order.currency)), {
      reply_markup: mainMenu(b),
    });
    await notifyAdminNewOrder(b.ctx, b.api, order, null);
    return;
  }
  if (result.zeroTotal) {
    b.customer = await setState(b.ctx, b.customer, { ...rest, mode: "idle" });
    await send(b, b.m.orderPaidByDiscounts(no), { reply_markup: mainMenu(b) });
    if (order.fulfillment_kind === "physical") {
      await b.ctx.db
        .from("orders")
        .update({ status: "accepted" })
        .eq("id", order.id)
        .eq("status", "awaiting_payment");
    } else {
      const r = await deliverOrder(
        b.ctx,
        order.id,
        telegramMaterialSender(b.api, b.chatId, b.m),
        b.locale,
      );
      if (r.failed === 0) await send(b, b.m.orderDelivered(no));
      if (r.pointsEarned > 0) await send(b, b.m.pointsEarned(r.pointsEarned));
      await notifyReferral(b.ctx, b.api, r.referral);
    }
    await notifyAdminNewOrder(b.ctx, b.api, order, null);
    return;
  }
  b.customer = await setState(b.ctx, b.customer, {
    ...rest,
    mode: "awaiting_proof",
    pending_order_id: order.id,
    pending_display_no: no,
  });
  const due = result.amountDue;
  const rk = await robokassaFor(b.ctx);
  if (rk.ready) {
    b.customer = await setState(b.ctx, b.customer, {
      ...rest,
      mode: "choose_pay",
      pending_order_id: order.id,
      pending_display_no: no,
    });
    await send(
      b,
      `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(formatMoney(due, order.currency))}\n\n${b.m.choosePayMethod}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: b.m.payViaRobokassaBtn, callback_data: `pay:rk:${order.id}` }],
            [{ text: b.m.payManualBtn, callback_data: `pay:manual:${order.id}` }],
          ],
        },
      },
    );
    return;
  }
  const depositLine =
    physical && due < Number(order.total)
      ? `${b.m.depositLine(formatMoney(due, order.currency), formatMoney(order.total, order.currency))}\n\n`
      : "";
  await sendManualInstructions(b, {
    no,
    due,
    total: Number(order.total),
    currency: order.currency,
    instructions: method.instructions,
    qr: method.qr_code_path,
    physical,
    depositLine,
  });
}

async function sendManualInstructions(
  b: Bot,
  p: {
    no: number;
    due: number;
    total: number;
    currency: string;
    instructions: string | null;
    qr: string | null;
    physical: boolean;
    depositLine: string;
  },
) {
  const text =
    `${b.m.manualTitleNew(p.no)}\n\n${b.m.amountToPay(formatMoney(p.due, p.currency))}\n${p.depositLine}\n` +
    `${escapeHtml(p.instructions || b.m.defaultInstructions)}\n\n${p.physical ? b.m.afterProofPhysical : b.m.afterProofManual}`;
  if (p.qr && text.length <= 1024) {
    const r = await b.api.call("sendPhoto", {
      chat_id: b.chatId,
      photo: imageUrl(b.ctx, p.qr),
      caption: text,
      parse_mode: "HTML",
    });
    if (r.ok) return;
  }
  await send(b, text);
  if (p.qr) await b.api.call("sendPhoto", { chat_id: b.chatId, photo: imageUrl(b.ctx, p.qr) });
}

/** Оплата картой подтверждена шлюзом: выдать цифровой заказ, сообщить покупателю и продавцу. */
export async function onOrderPaid(
  ctx: TenantContext,
  api: TelegramApi,
  orderId: number,
): Promise<void> {
  const order = await getOrder(ctx, orderId);
  if (!order) return;
  const customer = await getCustomer(ctx, order.user_key ?? `tg_${order.telegram_id}`);
  const locale = customer ? localeOf(ctx, customer) : "ru";
  const m = COPY[locale];
  const no = displayNo(order);
  await api.call("sendMessage", { chat_id: order.telegram_id, text: m.paymentReceived(no) });
  if (customer) await setState(ctx, customer, { ...customer.state, mode: "idle" });
  if (order.fulfillment_kind !== "physical") {
    const r = await deliverOrder(
      ctx,
      orderId,
      telegramMaterialSender(api, order.telegram_id, m),
      locale,
    );
    if (r.failed === 0 && !r.alreadyDelivered)
      await api.call("sendMessage", { chat_id: order.telegram_id, text: m.orderDelivered(no) });
    if (r.pointsEarned > 0)
      await api.call("sendMessage", {
        chat_id: order.telegram_id,
        text: m.pointsEarned(r.pointsEarned),
      });
    await notifyReferral(ctx, api, r.referral);
  }
  const fresh = await getOrder(ctx, orderId);
  if (fresh) await notifyAdminNewOrder(ctx, api, fresh, null, { paidOnline: true });
}

async function receiveProof(b: Bot, msg: TelegramMessage, orderId: number) {
  const fileId = msg.document?.file_id ?? msg.photo?.[msg.photo.length - 1]?.file_id;
  if (!fileId) return;
  const kind: "photo" | "document" = msg.document ? "document" : "photo";
  const file = await downloadTelegramFile(b.api, fileId);
  if (!file) {
    await send(b, b.m.proofFailed);
    return;
  }
  const docName = (msg.document?.file_name ?? "").toLowerCase();
  const ext =
    docName.match(/\.([a-z0-9]{1,8})$/)?.[1] ??
    (msg.document?.mime_type === "application/pdf" ? "pdf" : kind === "photo" ? "jpg" : "bin");
  const res = await attachPaymentProof(b.ctx, orderId, { bytes: file.bytes, mime: file.mime, ext });
  if (!res.ok) {
    const text =
      res.reason === "duplicate"
        ? b.m.proofDuplicate
        : res.reason === "closed" || res.reason === "not_found"
          ? b.m.proofOrderClosed
          : b.m.proofFailed;
    await send(b, text);
    return;
  }
  const no = displayNo(res.order);
  const proof = { fileId, kind };

  // Автопроверка чека (модуль receipt_ocr): цифровой заказ выдаётся сам,
  // сомнительный — продавцу с причиной, не-чек — просим прислать заново.
  const { receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
  if (res.order.fulfillment_kind !== "physical" && (await receiptOcrAutoEnabled(b.ctx))) {
    const { verifyReceipt } = await import("@/core/receipts/verify.server");
    const { isRetryReason } = await import("@/core/receipts/pure");
    const v = await verifyReceipt(b.ctx, {
      bytes: file.bytes,
      mime: file.mime,
      expectedAmount: Number(res.order.total),
      currency: res.order.currency,
      orderId,
    });
    if (!v.ok && isRetryReason(v.reason)) {
      await b.ctx.db
        .from("orders")
        .update({ status: "awaiting_payment", admin_note: `OCR: ${v.detail}`.slice(0, 500) })
        .eq("id", orderId)
        .eq("status", "awaiting_confirmation");
      await send(
        b,
        v.reason === "payment_failed"
          ? b.m.receiptPaymentFailed(String(no))
          : b.m.notReceiptLike(String(no)),
      );
      return;
    }
    b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "idle" });
    if (!v.ok) {
      await b.ctx.db
        .from("orders")
        .update({ admin_note: `OCR: ${v.detail}`.slice(0, 500) })
        .eq("id", orderId);
      await send(b, b.m.receiptManualReview(String(no)), { reply_markup: mainMenu(b) });
      await notifyAdminNewOrder(b.ctx, b.api, res.order, proof, { reviewReason: v.detail });
      return;
    }
    await b.ctx.db
      .from("orders")
      .update({ admin_note: `OCR ok: сумма ${v.matchedAmount}` })
      .eq("id", orderId);
    await send(b, b.m.receiptVerified(String(no)), { reply_markup: mainMenu(b) });
    const r = await deliverOrder(
      b.ctx,
      orderId,
      telegramMaterialSender(b.api, b.chatId, b.m),
      b.locale,
    );
    if (r.failed === 0 && !r.alreadyDelivered) await send(b, b.m.orderDelivered(no));
    if (r.pointsEarned > 0) await send(b, b.m.pointsEarned(r.pointsEarned));
    await notifyReferral(b.ctx, b.api, r.referral);
    const fresh = (await getOrder(b.ctx, orderId)) ?? res.order;
    await notifyAdminNewOrder(b.ctx, b.api, fresh, proof, { autoDelivered: r.failed === 0 });
    return;
  }

  b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "idle" });
  await send(b, b.m.proofReceived(no), { reply_markup: mainMenu(b) });
  await notifyAdminNewOrder(b.ctx, b.api, res.order, proof);
}

async function downloadTelegramFile(
  api: TelegramApi,
  fileId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const info = await api.call<{ file_path?: string }>("getFile", { file_id: fileId });
  const path = info.result?.file_path;
  if (!info.ok || !path) return null;
  const res = await fetch(api.fileUrl(path), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mime: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

async function askRating(b: Bot, productId: string, name: string) {
  await send(b, b.m.chooseRatingPrompt(escapeHtml(name)), {
    reply_markup: {
      inline_keyboard: [
        [1, 2, 3, 4, 5].map((n) => ({
          text: "⭐".repeat(n),
          callback_data: `stars:${productId}:${n}`,
        })),
      ],
    },
  });
}

/** Награда пригласившему после выдачи — своим сообщением, на своём языке. */
async function notifyReferral(
  ctx: TenantContext,
  api: TelegramApi,
  grant: ReferralGrant | null | undefined,
) {
  if (!grant) return;
  const { data: u } = await ctx.db
    .from("bot_users")
    .select("state")
    .eq("telegram_id", grant.telegramId)
    .maybeSingle();
  const st = stateFromJson(u?.state);
  const locale = isLocale(st.locale) ? st.locale : (ctx.tenant.settings.default_locale ?? "ru");
  await api.call("sendMessage", {
    chat_id: grant.telegramId,
    text: COPY[locale].referralReward(grant.percent, grant.code),
    parse_mode: "HTML",
  });
}

async function showMyOrders(b: Bot) {
  const orders = await listCustomerOrders(b.ctx, b.customer);
  if (orders.length === 0) {
    await send(b, b.m.myOrdersEmpty);
    return;
  }
  let text = b.m.myOrdersHeader;
  const buttons: InlineButton[][] = [];
  for (const o of orders) {
    const no = displayNo(o);
    const st = b.m.status[o.status] ?? o.status;
    text += `#${no} — ${formatMoney(o.total, o.currency)} — ${st}\n`;
    for (const i of o.order_items ?? [])
      text += `   • ${escapeHtml(i.name_snapshot)} × ${i.quantity}\n`;
    const row: InlineButton[] = [];
    if (o.status === "delivered" && o.fulfillment_kind !== "physical")
      row.push({ text: `${b.m.resendBtn} #${no}`, callback_data: `resend:${o.id}` });
    if (o.status === "delivered" && b.ctx.tenant.modules.review_request)
      row.push({ text: b.m.rateBtn(String(no)), callback_data: `rate:${o.id}` });
    if (row.length) buttons.push(row);
  }
  await send(
    b,
    text.slice(0, 4096),
    buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {},
  );
}

// ── callback-кнопки ───────────────────────────────────────────────────

const NAV_NEEDS_COUNTRY = /^(cat:|prod:|checkout$|cart:show$)/;

async function handleCallback(
  ctx: TenantContext,
  api: TelegramApi,
  cq: TelegramCallbackQuery,
): Promise<void> {
  const from = cq.from;
  const chatId = cq.message?.chat?.id;
  const data = cq.data ?? "";
  // «В корзину» отвечает своим текстом ниже; дважды ответить на один
  // callback Telegram не даёт.
  if (!data.startsWith("add:")) await api.call("answerCallbackQuery", { callback_query_id: cq.id });
  if (!from || !chatId) return;

  // Кнопки продавца в его чате/группе — до всех покупательских гвардов.
  if (data.startsWith("confirm:") || data.startsWith("reject:"))
    return adminDecision(ctx, api, from.id, chatId, data);

  if (await isBlocked(ctx, from.id)) return;
  if (ctx.tenant.status !== "active") {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: ctx.tenant.pausedMessage?.trim() || DEFAULT_PAUSED,
    });
    return;
  }
  const customer = await upsertCustomer(ctx, "telegram", from.id, {
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
    languageCode: from.language_code,
  });
  const locale = localeOf(ctx, customer);
  const b: Bot = { ctx, api, chatId, customer, locale, m: COPY[locale] };

  // Нажатия кнопок — тоже в лог чата, подписью кнопки, а не сырым callback_data.
  if (ctx.tenant.modules.manager_chat) {
    const label = cq.message?.reply_markup?.inline_keyboard
      ?.flat()
      .find((btn) => btn.callback_data === data)?.text;
    if (await inboundIntercepted(ctx, from.id, `👉 ${label ?? "нажал кнопку"}`)) return;
  }

  if (data.startsWith("locale:")) {
    const l = data.slice(7);
    if (isLocale(l)) await applyLocale(b, l);
    return;
  }
  if (data.startsWith("setcountry:") || data.startsWith("country:")) {
    const forCheckout = data.startsWith("country:");
    const code = data.split(":")[1] ?? "";
    const method = (await listActivePaymentMethods(ctx)).find((m) => m.country_code === code);
    if (!method) return void (await askCountry(b, forCheckout));
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      country_code: method.country_code,
      country_name: method.country_name,
    });
    await send(b, b.m.countrySaved(escapeHtml(method.country_name)));
    return forCheckout ? finishCheckout(b, method.country_code) : undefined;
  }
  if (NAV_NEEDS_COUNTRY.test(data) && !customer.state.country_code) return askCountry(b, false);

  if (data.startsWith("cat:")) {
    const [, id = "root", off = "0"] = data.split(":");
    return showCategories(b, id === "root" ? null : id, Number(off) || 0);
  }
  if (data.startsWith("prod:")) {
    const p = await getProduct(ctx, data.slice(5));
    return p ? sendProductCard(b, p) : void (await send(b, b.m.productNotFound));
  }
  if (data.startsWith("add:")) {
    const [, productId = "", variantId] = data.split(":");
    const r = await addToCart(ctx, customer, productId, variantId || null);
    const text = {
      ok: b.m.added,
      unavailable: b.m.unavailable,
      mixed_cart: b.m.mixedCart,
      digital_limit: b.m.digitalLimit,
      out_of_stock: b.m.outOfStock,
      error: b.m.orderCreateFailed,
    }[r];
    await api.call("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: text.slice(0, 200),
      show_alert: r !== "ok",
    });
    if (r === "ok")
      await send(b, `${b.m.added} · ${b.m.cart}`, {
        reply_markup: { inline_keyboard: [[{ text: b.m.cart, callback_data: "cart:show" }]] },
      });
    return;
  }
  if (data === "cart:show") return showCart(b);
  if (data.startsWith("rem:")) {
    await removeCartItem(ctx, customer, data.slice(4));
    return showCart(b);
  }
  if (data === "clear") {
    await clearCart(ctx, customer);
    await send(b, b.m.cartCleared);
    return;
  }
  if (data === "checkout") return startCheckout(b);
  if (data.startsWith("pay:")) {
    const [, kind, idRaw] = data.split(":");
    const order = await getOrder(ctx, Number(idRaw));
    if (!order || order.telegram_id !== customer.telegramId || order.status !== "awaiting_payment")
      return;
    const no = displayNo(order);
    const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
    const due = await amountDueNow(ctx, {
      total: Number(order.total),
      fulfillment_kind: order.fulfillment_kind,
    });
    if (kind === "rk") {
      const rk = await robokassaFor(ctx);
      if (!rk.ready) return;
      const url = buildPaymentUrl(rk, {
        outSum: due,
        invId: order.id,
        description: `Заказ #${no}`,
        botId: ctx.tenant.id,
      });
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        mode: "awaiting_payment",
        pending_order_id: order.id,
        pending_display_no: no,
      });
      await send(
        b,
        `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(formatMoney(due, order.currency))}\n\n${b.m.robokassaHint}`,
        { reply_markup: { inline_keyboard: [[{ text: b.m.payViaRobokassaBtn, url }]] } },
      );
      return;
    }
    if (kind === "manual") {
      const method =
        (await listActivePaymentMethods(ctx)).find((x) => x.country_code === order.country_code) ??
        null;
      const physical = order.fulfillment_kind === "physical";
      b.customer = await setState(ctx, customer, {
        ...customer.state,
        mode: "awaiting_proof",
        pending_order_id: order.id,
        pending_display_no: no,
      });
      const depositLine =
        physical && due < Number(order.total)
          ? `${b.m.depositLine(formatMoney(due, order.currency), formatMoney(order.total, order.currency))}\n\n`
          : "";
      return sendManualInstructions(b, {
        no,
        due,
        total: Number(order.total),
        currency: order.currency,
        instructions: method?.instructions ?? null,
        qr: method?.qr_code_path ?? null,
        physical,
        depositLine,
      });
    }
    return;
  }
  if (data.startsWith("fulfilltype:")) {
    if (customer.state.mode !== "awaiting_fulfillment_type") return;
    const type = data.slice(12);
    if (type !== "pickup" && type !== "delivery") return;
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      checkout_fulfillment_type: type,
    });
    return askFulfillmentDate(b);
  }
  if (data.startsWith("zone:")) {
    if (customer.state.mode !== "awaiting_delivery_zone") return;
    return pickZone(b, data.slice(5));
  }
  if (data === "fulfillnote:skip") {
    if (customer.state.mode !== "awaiting_fulfillment_note") return;
    return finishAfterNote(b, null);
  }
  if (data === "promo:enter") {
    b.customer = await setState(ctx, customer, { ...customer.state, mode: "awaiting_promo_code" });
    return void (await send(b, b.m.promoCodePrompt));
  }
  if (data === "promo:clear") {
    const { promo_code: _pc, ...rest } = customer.state;
    b.customer = await setState(ctx, customer, rest);
    await send(b, b.m.promoCodeRemoved);
    return showCart(b);
  }
  if (data === "giftcert:enter") {
    b.customer = await setState(ctx, customer, {
      ...customer.state,
      mode: "awaiting_gift_certificate_code",
    });
    return void (await send(b, b.m.giftCertificateCodePrompt));
  }
  if (data === "giftcert:clear") {
    const { gift_certificate_code: _gc, ...rest } = customer.state;
    b.customer = await setState(ctx, customer, rest);
    await send(b, b.m.giftCertificateRemoved);
    return showCart(b);
  }
  if (data === "points:use" || data === "points:clear") {
    const { use_points: _u, ...rest } = customer.state;
    b.customer = await setState(
      ctx,
      customer,
      data === "points:use" ? { ...rest, use_points: true } : rest,
    );
    return showCart(b);
  }
  if (data.startsWith("rate:") && ctx.tenant.modules.review_request) {
    const products = await reviewableProductsForOrder(ctx, Number(data.slice(5)), from.id);
    if (products.length === 0) return send(b, b.m.noReviewableProducts);
    if (products.length === 1) return askRating(b, products[0]!.productId, products[0]!.name);
    return send(b, b.m.chooseProductToRate, {
      reply_markup: {
        inline_keyboard: products.map((p) => [
          { text: p.name, callback_data: `rateproduct:${p.productId}` },
        ]),
      },
    });
  }
  if (data.startsWith("rateproduct:") && ctx.tenant.modules.review_request) {
    const productId = data.slice(12);
    if (!(await hasDeliveredPurchase(ctx, from.id, productId)))
      return send(b, b.m.reviewNotAllowed);
    const p = await getProduct(ctx, productId);
    return askRating(b, productId, p?.name ?? "");
  }
  if (data.startsWith("stars:") && ctx.tenant.modules.review_request) {
    const [, productId = "", raw = ""] = data.split(":");
    const rating = Number(raw);
    if (!isValidRating(rating)) return;
    if (!(await hasDeliveredPurchase(ctx, from.id, productId)))
      return send(b, b.m.reviewNotAllowed);
    await saveRating(ctx, from.id, productId, rating);
    b.customer = await setState(ctx, b.customer, {
      ...b.customer.state,
      mode: "awaiting_review_comment",
      review_product_id: productId,
    });
    return send(b, b.m.reviewSaved, {
      reply_markup: {
        inline_keyboard: [[{ text: b.m.reviewSkipBtn, callback_data: "reviewskip" }]],
      },
    });
  }
  if (data === "reviewskip") {
    const { review_product_id: _rp, ...rest } = b.customer.state;
    b.customer = await setState(ctx, b.customer, { ...rest, mode: "idle" });
    return send(b, b.m.useMenu);
  }
  if (data.startsWith("resend:")) {
    const order = await getOrder(ctx, Number(data.slice(7)));
    if (!order || order.telegram_id !== customer.telegramId || order.status !== "delivered") return;
    await ctx.db
      .from("orders")
      .update({ status: "paid" })
      .eq("id", order.id)
      .eq("status", "delivered");
    const r = await deliverOrder(ctx, order.id, telegramMaterialSender(api, chatId, b.m), locale);
    if (!r.alreadyDelivered) await send(b, b.m.orderDelivered(displayNo(order)));
    return;
  }
}

async function adminDecision(
  ctx: TenantContext,
  api: TelegramApi,
  fromId: number,
  chatId: number,
  data: string,
) {
  const admins = await shopAdminIds(ctx);
  if (!admins.includes(String(fromId))) {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: "⛔ Кнопка доступна только администратору магазина (app_settings.admin_chat_id).",
    });
    return;
  }
  const orderId = Number(data.split(":")[1]);
  const order = await getOrder(ctx, orderId);
  if (!order)
    return void (await api.call("sendMessage", {
      chat_id: chatId,
      text: `Заказ #${orderId} не найден.`,
    }));
  const no = displayNo(order);
  const buyerLocale: Locale = "ru";
  const m = COPY[buyerLocale];

  if (data.startsWith("reject:")) {
    const ok = await rejectOrder(ctx, orderId);
    await api.call("sendMessage", {
      chat_id: chatId,
      text: ok ? `❌ Заказ #${no} отклонён.` : `Заказ #${no} уже закрыт (${order.status}).`,
    });
    if (ok && order.platform === "telegram")
      await api.call("sendMessage", { chat_id: order.telegram_id, text: m.orderRejected(no) });
    return;
  }
  if (order.platform !== "telegram") {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: `Заказ #${no} из ${order.platform}: выдача этого канала переносится в следующей фазе v2.`,
    });
    return;
  }
  if (order.fulfillment_kind === "physical") {
    await ctx.db
      .from("orders")
      .update({ status: "accepted" })
      .eq("id", orderId)
      .in("status", ["awaiting_payment", "awaiting_confirmation"]);
    await api.call("sendMessage", { chat_id: chatId, text: `✅ Заказ #${no} принят в работу.` });
    return;
  }
  const r = await deliverOrder(
    ctx,
    orderId,
    telegramMaterialSender(api, order.telegram_id, m),
    buyerLocale,
  );
  if (r.alreadyDelivered)
    return void (await api.call("sendMessage", {
      chat_id: chatId,
      text: `Заказ #${no} уже выдан.`,
    }));
  if (r.failed === 0) {
    await api.call("sendMessage", { chat_id: order.telegram_id, text: m.orderDelivered(no) });
    if (r.pointsEarned > 0) {
      await api.call("sendMessage", {
        chat_id: order.telegram_id,
        text: m.pointsEarned(r.pointsEarned),
      });
    }
    await notifyReferral(ctx, api, r.referral);
    await api.call("sendMessage", {
      chat_id: chatId,
      text: `✅ Заказ #${no} выдан (${r.sent} поз.).`,
    });
  } else {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: `⚠️ Заказ #${no}: выдано ${r.sent}, не удалось ${r.failed}. Заказ возвращён в «чек на проверке» — повторите после проверки файлов товара.`,
    });
  }
}
