import type { TelegramApi } from "./api";
import type { Tenant } from "@/core/tenant/types";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

/**
 * Меню команд бота (кнопка «/» у поля ввода). Telegram показывает список на
 * языке клиента покупателя: для каждого языка — свой setMyCommands с
 * language_code, без него — список на языке магазина по умолчанию.
 * Ставится только при включении v2 для бота (core/tenant/telegram-webhook):
 * боту клиента v1 ничего не ставим.
 */
export type BotCommand = "catalog" | "cart" | "orders" | "language" | "stop";

const DESCRIPTIONS: Record<Locale, Record<BotCommand, string>> = {
  ru: {
    catalog: "Каталог",
    cart: "Корзина",
    orders: "Мои заказы",
    language: "Сменить язык",
    stop: "Отписаться от рассылок",
  },
  kk: {
    catalog: "Каталог",
    cart: "Себет",
    orders: "Менің тапсырыстарым",
    language: "Тілді ауыстыру",
    stop: "Хабарламалардан бас тарту",
  },
  en: {
    catalog: "Catalog",
    cart: "Cart",
    orders: "My orders",
    language: "Change language",
    stop: "Unsubscribe from mailings",
  },
  uz: {
    catalog: "Katalog",
    cart: "Savat",
    orders: "Buyurtmalarim",
    language: "Tilni o‘zgartirish",
    stop: "Xabarnomalardan voz kechish",
  },
};

/** Какие команды у этого бота: /language — только с модулем «Несколько языков». */
export function botCommandNames(tenant: Tenant): BotCommand[] {
  const out: BotCommand[] = ["catalog", "cart", "orders"];
  if (tenant.modules.multi_language) out.push("language");
  out.push("stop");
  return out;
}

export function botCommandList(
  tenant: Tenant,
  locale: Locale,
): Array<{ command: string; description: string }> {
  return botCommandNames(tenant).map((c) => ({
    command: c,
    description: DESCRIPTIONS[locale][c],
  }));
}

/**
 * Отпечаток набора: крон ensure-webhook переставляет меню, когда он другой
 * (новые команды в коде или включили/выключили «Несколько языков»).
 */
export function botCommandsVersion(tenant: Tenant): string {
  return `1:${botCommandNames(tenant).join(",")}:${tenant.settings.default_locale ?? "ru"}`;
}

/** Текст сообщения → команда меню; «/catalog@shop_bot» из групп тоже. */
export function botCommandFor(text: string | null | undefined): BotCommand | null {
  const m = /^\/([a-z]+)(@\w+)?$/i.exec(text?.trim() ?? "");
  const c = m?.[1]?.toLowerCase();
  return c === "catalog" || c === "cart" || c === "orders" || c === "language" || c === "stop"
    ? c
    : null;
}

/** Поставить меню команд на всех языках. Любой отказ Telegram — ошибка. */
export async function syncBotCommands(tenant: Tenant, api: TelegramApi): Promise<void> {
  const fallback = tenant.settings.default_locale ?? "ru";
  const calls: Array<Record<string, unknown>> = [
    { commands: botCommandList(tenant, fallback) },
    ...SUPPORTED_LOCALES.map((l) => ({
      commands: botCommandList(tenant, l),
      language_code: l,
    })),
  ];
  for (const payload of calls) {
    const r = await api.call("setMyCommands", payload);
    if (!r.ok) throw new Error(`setMyCommands: ${r.description ?? "отказ Telegram"}`);
  }
}

/** Откат на v1: убрать наше меню, чтобы бот v1 не показывал чужих команд. */
export async function clearBotCommands(api: TelegramApi): Promise<void> {
  await api.call("deleteMyCommands", {});
  for (const l of SUPPORTED_LOCALES) await api.call("deleteMyCommands", { language_code: l });
}
