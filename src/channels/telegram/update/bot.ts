// Общее для сценариев бота: контекст разговора и отправка.
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "../api";
import { mainMenu as screenMainMenu } from "../screens";
import { menuActionFor, type Msg } from "../copy";
import { isLocale, type Locale, SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { verticalDef } from "@/core/verticals/registry";
import type { Customer } from "@/core/customers/customers";

export const PAGE = 5;
export const DEFAULT_PAUSED = "Бот временно недоступен. Загляните чуть позже — мы уже разбираемся.";

export type Bot = {
  ctx: TenantContext;
  api: TelegramApi;
  chatId: number;
  customer: Customer;
  locale: Locale;
  m: Msg;
  /**
   * Продаёт ли клиент сейчас (core/tenant/sells): консультант без товаров (BOVI) —
   * нет. Тогда меню без каталога и корзины, а вопросы — консультанту.
   */
  sells: boolean;
};

export function localeOf(ctx: TenantContext, customer: Customer): Locale {
  const fromState = customer.state.locale;
  if (isLocale(fromState)) return fromState;
  return ctx.tenant.settings.default_locale ?? "ru";
}

export async function send(
  b: Bot,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await b.api.call("sendMessage", {
    chat_id: b.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

export function contactLabels(ctx: TenantContext): string[] {
  const def = verticalDef(ctx.tenant.vertical);
  return SUPPORTED_LOCALES.map((l) => def.locales[l].contactBtn);
}

export function mainMenu(b: Bot) {
  return screenMainMenu(b.ctx.tenant, b.locale, b.ctx.appUrl, b.sells);
}

export async function sendMain(b: Bot, text?: string) {
  await send(b, text ?? b.m.chooseSection, { reply_markup: mainMenu(b) });
}

/** Кнопки и команды магазина: у консультанта без товаров их нет. */
export const SHOP_ACTIONS = new Set<ReturnType<typeof menuActionFor>>([
  "catalog",
  "search",
  "cart",
]);
