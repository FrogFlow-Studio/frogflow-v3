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

async function send(b: Bot, text: string, extra: Record<string, unknown> = {}) {
  return b.api.call("sendMessage", {
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
  return { keyboard, resize_keyboard: true };
}

async function sendMain(b: Bot, text?: string) {
  await send(b, text ?? b.m.chooseSection, { reply_markup: mainMenu(b) });
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

  if (text?.startsWith("/start")) return startFlow(b);

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

async function startFlow(b: Bot) {
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
    await send(b, b.m.searchNothing(escapeHtml(query)));
    return;
  }
  await send(b, b.m.searchResults(escapeHtml(query), found.length));
  for (const p of found.slice(0, PAGE)) await sendProductCard(b, p);
}

// ── корзина и оформление ──────────────────────────────────────────────

async function showCart(b: Bot) {
  const items = await listCart(b.ctx, b.customer);
  if (items.length === 0) {
    await send(b, b.m.cartEmpty);
    return;
  }
  const priced = await priceCart(b.ctx, items, b.customer.state.country_code ?? null);
  let text = b.m.cartHeader;
  const buttons: InlineButton[][] = [];
  for (const line of priced.lines) {
    text += `• ${escapeHtml(line.name)} × ${line.item.quantity} — ${formatMoney(line.line, priced.currency)}\n`;
    buttons.push([{ text: b.m.removeItem(line.name), callback_data: `rem:${line.item.id}` }]);
  }
  text += b.m.total(formatMoney(priced.total, priced.currency));
  buttons.push([
    { text: b.m.checkoutBtn, callback_data: "checkout" },
    { text: b.m.clearBtn, callback_data: "clear" },
  ]);
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
  return finishCheckout(b, b.customer.state.country_code);
}

async function finishCheckout(b: Bot, countryCode: string) {
  const result = await placeOrder(b.ctx, b.customer, countryCode);
  if (!result.ok) {
    switch (result.reason) {
      case "busy":
        return void (await send(b, b.m.checkoutBusy));
      case "empty_cart":
        return void (await send(b, b.m.cartEmpty));
      case "country_unavailable":
        await send(b, b.m.countryNoLongerAvailable);
        return askCountry(b, true);
      default:
        return void (await send(b, b.m.orderCreateFailed));
    }
  }
  const { order, method } = result;
  const no = displayNo(order);
  const { placing_order: _p, ...rest } = b.customer.state;
  b.customer = await setState(b.ctx, b.customer, {
    ...rest,
    mode: "awaiting_proof",
    pending_order_id: order.id,
    pending_display_no: no,
  });
  const text =
    `${b.m.manualTitleNew(no)}\n\n${b.m.amountToPay(formatMoney(order.total, order.currency))}\n\n` +
    `${escapeHtml(method.instructions || b.m.defaultInstructions)}\n\n${b.m.afterProofManual}`;
  if (method.qr_code_path && text.length <= 1024) {
    const r = await b.api.call("sendPhoto", {
      chat_id: b.chatId,
      photo: imageUrl(b.ctx, method.qr_code_path),
      caption: text,
      parse_mode: "HTML",
    });
    if (r.ok) return;
  }
  await send(b, text);
  if (method.qr_code_path)
    await b.api.call("sendPhoto", {
      chat_id: b.chatId,
      photo: imageUrl(b.ctx, method.qr_code_path),
    });
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
  b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, mode: "idle" });
  await send(b, b.m.proofReceived(displayNo(res.order)), { reply_markup: mainMenu(b) });
  await notifyAdminNewOrder(b.ctx, b.api, res.order, { fileId, kind });
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
    if (o.status === "delivered" && o.fulfillment_kind !== "physical")
      buttons.push([{ text: `${b.m.resendBtn} #${no}`, callback_data: `resend:${o.id}` }]);
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
