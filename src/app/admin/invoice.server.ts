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
export function invoiceText(cart: PricedCart, locale: string): string {
  const m = COPY[isLocale(locale) ? locale : "ru"];
  let text = m.invoiceHeader;
  cart.lines.forEach((line, i) => {
    text += `${i + 1}. ${escapeHtml(line.name)} × ${line.item.quantity} — ${formatMoney(line.line, cart.currency)}\n`;
  });
  text += m.total(formatMoney(cart.total, cart.currency));
  return text + m.invoiceFooter;
}

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
 * «Выставить счёт» из «Чата»: корзина покупателю и сообщение с кнопкой
 * «Оформить заказ» в его канал. Оформление ведёт бот, поэтому диалог
 * возвращается боту: пока менеджер «в чате», нажатия кнопок бот не видит.
 */
export async function sendDialogInvoice(
  ctx: TenantContext,
  telegramId: number,
  items: InvoiceItem[],
  opts: { append?: boolean } = {},
): Promise<{ total: number; currency: string }> {
  const { getCustomerByTelegramId, isBlocked } = await import("@/core/customers/customers");
  const customer = await getCustomerByTelegramId(ctx, telegramId);
  if (!customer) throw new UserError("err.invoice.noCustomer", "Покупатель не найден.");
  if (await isBlocked(ctx, telegramId))
    throw new UserError("err.invoice.blocked", "Покупатель заблокирован.");

  const platform = customer.platform;
  const zernio = platform === "instagram" || platform === "whatsapp";
  if (zernio) {
    const shopOn =
      platform === "whatsapp" ? ctx.tenant.modules.wa_shop : ctx.tenant.modules.dm_shop;
    const { loadDirectBotSettings } = await import("@/core/instagram/direct-bot-settings");
    const bot = shopOn ? await loadDirectBotSettings(ctx, platform) : null;
    if (!bot?.enabled || !bot.features.checkout)
      throw new UserError(
        "err.invoice.noShopInChannel",
        "В этом канале выключено оформление заказа — счёт покупатель не сможет оплатить.",
      );
    if (!customer.zernioConversationId || !customer.zernioAccountId)
      throw new UserError(
        "err.admin.noZernioDialog",
        "У покупателя нет диалога в Zernio — ответить некуда",
      );
  } else if (!ctx.tenant.telegramTokenEnc)
    throw new UserError("err.invoice.noBot", "У магазина не подключён Telegram-бот.");

  const { fillCartForCustomer } = await import("@/core/cart/seller-cart");
  const r = await fillCartForCustomer(ctx, customer, items, opts);
  if (!r.ok) {
    throw invoiceError(r.reason);
  }

  const locale = customer.state.locale ?? ctx.tenant.settings.default_locale ?? "ru";
  const html = invoiceText(r.cart, locale);
  const m = COPY[isLocale(locale) ? locale : "ru"];
  if (zernio) {
    const { sendInboxMessage } = await import("@/channels/zernio/api.server");
    const sent = await sendInboxMessage(
      customer.zernioConversationId!,
      customer.zernioAccountId!,
      plain(html).slice(0, 2000),
      {
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
  await chat.disconnect(ctx, telegramId).catch(() => {});
  return { total: r.cart.total, currency: r.cart.currency };
}
