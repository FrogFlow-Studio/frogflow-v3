import { serverFailure } from "@/lib/server-failure";
import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { telegramApi } from "@/channels/telegram/api";
import { COPY, escapeHtml } from "@/channels/telegram/copy";
import { plain } from "@/channels/zernio/shop-flow";
import { formatMoney } from "@/core/money/money";
import { isLocale } from "@/core/i18n/locale";
import type { PricedCart } from "@/core/cart/cart";
import type { InvoiceItem } from "@/core/cart/seller-cart";

/** Текст счёта: позиции, итог и подсказка «Оформить заказ» — на языке покупателя. */
export function invoiceText(cart: PricedCart, locale: string, footer?: string): string {
  const m = COPY[isLocale(locale) ? locale : "ru"];
  let text = m.invoiceHeader;
  cart.lines.forEach((line, i) => {
    text += `${i + 1}. ${escapeHtml(line.name)} × ${line.item.quantity} — ${formatMoney(line.line, cart.currency)}\n`;
  });
  text += m.total(formatMoney(cart.total, cart.currency));
  return text + (footer ?? m.invoiceFooter);
}

/**
 * Текст счёта для Direct/WhatsApp — не длиннее 2000 знаков. Длинный состав
 * обрезается, а подвал со ссылкой на оплату остаётся целым.
 */
export function fitDirect(cart: PricedCart, locale: string, footer?: string): string {
  const full = plain(invoiceText(cart, locale, footer));
  if (full.length <= DIRECT_MAX) return full;
  const tail = plain(footer ?? COPY[isLocale(locale) ? locale : "ru"].invoiceFooter);
  const head = plain(invoiceText(cart, locale, ""));
  return `${head.slice(0, DIRECT_MAX - tail.length - 2)}…\n${tail}`.slice(0, DIRECT_MAX);
}

const DIRECT_MAX = 2000;

/** Почему счёт не собрался — словами продавцу (те же проверки, что у корзины покупателя). */
function invoiceError(reason: string): UserError {
  switch (reason) {
    case "empty":
      return new UserError("err.invoice.empty", "Добавьте хотя бы одну позицию.");
    case "unavailable":
      return new UserError(
        "err.invoice.unavailable",
        "Товар скрыт, удалён или вариант выбран неверно.",
      );
    case "mixed_cart":
      return new UserError("err.invoice.mixed", "Цифровые и физические товары — разными счетами.");
    case "digital_limit":
      return new UserError("err.invoice.digitalLimit", "Цифровой товар — одна штука в счёте.");
    case "out_of_stock":
      return new UserError("err.invoice.outOfStock", "Не хватает товара на складе.");
    default:
      return new UserError("err.invoice.failed", "Не удалось собрать счёт, попробуйте ещё раз.");
  }
}

/**
 * Как счёт дойдёт до покупателя этого канала: «channel» — кнопкой «Оформить
 * заказ» в его мессенджере (оформление ведёт бот); «link» — Instagram/WhatsApp
 * без оформления в канале, но с оплатой на витрине сайта: заказ создаётся
 * сразу, покупателю уходит ссылка на страницу заказа; «none» — счёт выставить
 * нельзя (тогда кнопки в «Чате» нет, есть подсказка).
 */
export type InvoiceMode = "channel" | "link" | "none";

export async function webPayAvailable(ctx: TenantContext): Promise<boolean> {
  if (!ctx.tenant.settings.slug) return false;
  const { storefrontOpen } = await import("@/core/storefront/access");
  if (!storefrontOpen(ctx.tenant, "web_checkout")) return false;
  const { webCheckoutSettings } = await import("@/core/storefront/web-order");
  return (await webCheckoutSettings(ctx)).enabled;
}

export async function invoiceMode(ctx: TenantContext, platform: string): Promise<InvoiceMode> {
  if (platform !== "instagram" && platform !== "whatsapp")
    return ctx.tenant.telegramTokenEnc ? "channel" : "none";
  const shopOn = platform === "whatsapp" ? ctx.tenant.modules.wa_shop : ctx.tenant.modules.dm_shop;
  const { loadDirectBotSettings } = await import("@/core/instagram/direct-bot-settings");
  const bot = shopOn ? await loadDirectBotSettings(ctx, platform) : null;
  if (bot?.enabled && bot.features.checkout) return "channel";
  return (await webPayAvailable(ctx)) ? "link" : "none";
}

function linkPhysicalError(): UserError {
  return new UserError(
    "err.invoice.linkPhysical",
    "Физические товары ссылкой на сайт не выставить: покупателю нужно выбрать дату и адрес. Включите оформление заказа в этом канале.",
  );
}

async function hasPhysical(ctx: TenantContext, items: InvoiceItem[]): Promise<boolean> {
  const ids = [...new Set(items.map((i) => i.productId))];
  if (ids.length === 0) return false;
  const { data, error: dataError } = await ctx.db
    .from("products")
    .select("id")
    .in("id", ids)
    .eq("fulfillment_kind", "physical")
    .limit(1);
  if (dataError) throw serverFailure(`Счёт: ${dataError.message}`);
  return (data ?? []).length > 0;
}

/**
 * Счёт ссылкой: заказ из собранной корзины тем же placeOrder, что в боте
 * (номер, склад, события), и ссылка на его страницу на сайте — там реквизиты,
 * чек с автопроверкой и оплата картой. Только цифровые товары: физическим
 * нужны дата и адрес, их спрашивает оформление в канале или на сайте.
 */
async function placeInvoiceOrder(
  ctx: TenantContext,
  customer: import("@/core/customers/customers").Customer,
  cart: PricedCart,
): Promise<{ id: number; no: number; url: string }> {
  if (cart.kind === "physical") throw linkPhysicalError();
  const { displayNo, listActivePaymentMethods, placeOrder, rejectOrder } =
    await import("@/core/orders/orders");
  const country =
    customer.state.country_code ?? (await listActivePaymentMethods(ctx))[0]?.country_code ?? null;
  if (!country)
    throw new UserError("err.invoice.noPayment", "Не настроены способы оплаты магазина.");
  const r = await placeOrder(ctx, customer, country, { skipMinOrder: true });
  if (!r.ok)
    throw r.reason === "out_of_stock"
      ? invoiceError("out_of_stock")
      : r.reason === "country_unavailable"
        ? new UserError("err.invoice.noPayment", "Не настроены способы оплаты магазина.")
        : invoiceError(r.reason === "empty_cart" ? "empty" : "failed");
  // Признак «счёт ссылкой»: страница заказа, срок оплаты и возврат остатка.
  // Без признака заказ не истёк бы и держал остаток: такой счёт отменяем
  // сразу, продавцу — «счёт отменён», его можно выставить заново. Остаток
  // возвращает только rejectOrder: признак мог записаться, хотя ответ не
  // дошёл (тогда rejectOrder вернул бы его и сам), поэтому — опцией, а не
  // вторым вызовом.
  const { markInvoiceLink } = await import("@/core/orders/invoice-link");
  try {
    await markInvoiceLink(ctx, r.order.id);
  } catch (e) {
    const cancelled = await rejectOrder(ctx, r.order.id, "invoice", {
      from: ["awaiting_payment"],
      to: "cancelled",
      restoreStock: true,
    });
    if (!cancelled) throw e;
    console.warn(`[invoice] счёт #${r.order.id} отменён: ${String(e)}`);
    throw new UserError(
      "err.invoice.cancelled",
      "Счёт не сохранился и отменён, покупателю ничего не ушло. Выставьте его заново.",
    );
  }
  if (r.zeroTotal) {
    // Скидки покрыли всё — выдаём сразу, как бот.
    const { runOrderAction } = await import("./admin.server");
    await runOrderAction(ctx, r.order.id, "confirm", "invoice");
  }
  const { orderAccessToken } = await import("@/core/storefront/web-order");
  const token = orderAccessToken(env().SESSION_SECRET, ctx.tenant.id, r.order.id);
  const slug = encodeURIComponent(ctx.tenant.settings.slug!);
  return {
    id: r.order.id,
    no: displayNo(r.order),
    url: `${ctx.appUrl}/s/${slug}/order/${r.order.id}?t=${token}`,
  };
}

/**
 * «Выставить счёт» из «Чата»: корзина покупателю и сообщение с кнопкой
 * «Оформить заказ» в его канал. Оформление ведёт бот, поэтому диалог
 * возвращается боту: пока менеджер «в чате», нажатия кнопок бот не видит.
 */
export async function sendDialogInvoice(
  ctx: TenantContext,
  telegramId: number,
  items: InvoiceItem[],
  opts: { append?: boolean } = {},
): Promise<{ total: number; currency: string; orderId?: number; orderNo?: number }> {
  const { getCustomerByTelegramId, isBlocked } = await import("@/core/customers/customers");
  const customer = await getCustomerByTelegramId(ctx, telegramId);
  if (!customer) throw new UserError("err.invoice.noCustomer", "Покупатель не найден.");
  if (await isBlocked(ctx, telegramId))
    throw new UserError("err.invoice.blocked", "Покупатель заблокирован.");

  const platform = customer.platform;
  const zernio = platform === "instagram" || platform === "whatsapp";
  const mode = await invoiceMode(ctx, platform);
  if (mode === "none")
    throw zernio
      ? new UserError(
          "err.invoice.noShopInChannel",
          "В этом канале выключено оформление заказа — счёт покупатель не сможет оплатить.",
        )
      : new UserError("err.invoice.noBot", "У магазина не подключён Telegram-бот.");
  if (zernio && (!customer.zernioConversationId || !customer.zernioAccountId))
    throw new UserError(
      "err.admin.noZernioDialog",
      "У покупателя нет диалога в Zernio — ответить некуда",
    );

  // Физические товары ссылкой не выставить — до того, как корзина покупателя заменена.
  if (mode === "link" && (await hasPhysical(ctx, items))) throw linkPhysicalError();
  const { fillCartForCustomer } = await import("@/core/cart/seller-cart");
  const r = await fillCartForCustomer(ctx, customer, items, opts);
  if (!r.ok) {
    throw invoiceError(r.reason);
  }

  const locale = customer.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
  const m = COPY[isLocale(locale) ? locale : "ru"];
  const link = mode === "link" ? await placeInvoiceOrder(ctx, customer, r.cart) : null;
  const html = invoiceText(r.cart, locale, link ? m.invoicePayLink(link.no, link.url) : undefined);
  if (zernio) {
    const { sendInboxMessage } = await import("@/channels/zernio/api.server");
    const sent = await sendInboxMessage(
      customer.zernioConversationId!,
      customer.zernioAccountId!,
      fitDirect(r.cart, locale, link ? m.invoicePayLink(link.no, link.url) : undefined),
      link
        ? { platform }
        : {
            platform,
            buttons: [{ type: "postback", title: plain(m.checkoutBtn), payload: "CHECKOUT" }],
          },
    );
    if (!sent.ok)
      throw sent.error
        ? new Error(sent.error)
        : new UserError("err.admin.sendFailed", "Не удалось отправить сообщение");
  } else {
    const sent = await telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE).call(
      "sendMessage",
      {
        chat_id: telegramId,
        text: html,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: m.checkoutBtn, callback_data: "checkout" }]] },
      },
    );
    if (!sent.ok)
      throw sent.description
        ? new Error(sent.description)
        : new UserError(
            "err.admin.sendTelegramFailed",
            "Не удалось отправить сообщение в Telegram",
          );
  }

  const chat = await import("@/core/chat/chat");
  await chat.recordMessage(ctx, {
    telegramId,
    direction: "out",
    sender: "manager",
    text: plain(html),
  });
  // Кнопку «Оформить заказ» обрабатывает бот — диалог возвращаем ему. По
  // ссылке оформлять уже нечего: менеджер остаётся в диалоге.
  if (!link) await chat.disconnect(ctx, telegramId).catch(() => {});
  return {
    total: r.cart.total,
    currency: r.cart.currency,
    ...(link ? { orderId: link.id, orderNo: link.no } : {}),
  };
}
