import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting } from "@/core/settings/settings";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { verticalDef } from "@/core/verticals/registry";
import { COPY } from "@/channels/telegram/copy";
import { plain } from "@/channels/zernio/flow/classify";
import { directBase } from "@/channels/zernio/shop/copy";
import {
  BOT_TEXT_CHANNELS,
  BOT_TEXT_KEYS,
  BOT_TEXT_VARS,
  MSG_PROPS,
  OPT_IN,
  STANDARD,
  WIRED,
  cleanBotText,
  cleanWorkHours,
  type BotTextChannel,
  type BotTextKey,
  type WorkHours,
} from "@/core/bot-texts/registry";

/**
 * Страница «Тексты бота»: что бот говорит сам, стандартный текст и свой текст
 * продавца по каналам и языкам. Хранение — bots.settings.bot_texts и
 * bots.settings.work_hours через patchTenantSettings; ключи других настроек
 * не затираются, каждый текст целиком заменяет прежний.
 */
export type BotTextRow = {
  key: BotTextKey;
  /** Дополнительное сообщение: пока своего текста нет, не отправляется. */
  optIn: boolean;
  vars: readonly string[];
  /** Стандартный текст по языкам (с {именами}); у opt-in его нет в боте, он только образец. */
  standard: Record<Locale, string>;
  /** Свои тексты по каналам и языкам. */
  custom: Partial<Record<BotTextChannel, Partial<Record<Locale, string>>>>;
};

export type BotTextsView = {
  shopName: string;
  locales: Locale[];
  channels: Array<{ channel: BotTextChannel; wired: BotTextKey[] }>;
  workHours: WorkHours | null;
  rows: BotTextRow[];
};

function standardOf(key: BotTextKey, shopName: string, vertical: string): Record<Locale, string> {
  const out = {} as Record<Locale, string>;
  for (const l of SUPPORTED_LOCALES) {
    if (key === "welcome") {
      const v = verticalDef(vertical as never).locales[l];
      out[l] = `${shopName}\n${v.welcomeGreeting}\n\n→ ${v.welcomeCatalog}\n→ ${v.welcomePayment}`;
    } else if (key === "not_understood") out[l] = COPY[l].useMenu;
    else if (MSG_PROPS[key]) {
      // Фраза словаря бота; у фразы-функции вместо значений — {подстановки} ключа.
      // Подключены только к Instagram: стандарт — каким он уходит там.
      const std = (directBase("instagram", l) as Record<string, unknown>)[MSG_PROPS[key][0]!];
      out[l] = plain(
        typeof std === "function"
          ? (std as (...a: string[]) => string)(...BOT_TEXT_VARS[key].map((v) => `{${v}}`))
          : String(std),
      );
    } else out[l] = STANDARD[key]![l];
  }
  return out;
}

export async function botTexts(ctx: TenantContext): Promise<BotTextsView> {
  const t = ctx.tenant;
  const shopName = (await getSetting(ctx, "shop_name")) ?? t.name;
  const fallback = t.settings.default_locale ?? "ru";
  const locales = t.modules.multi_language ? [...SUPPORTED_LOCALES] : [fallback];
  return {
    shopName,
    locales,
    channels: BOT_TEXT_CHANNELS.map((channel) => ({ channel, wired: [...WIRED[channel]] })),
    workHours: cleanWorkHours(t.settings.work_hours),
    rows: BOT_TEXT_KEYS.map((key) => {
      const custom: BotTextRow["custom"] = {};
      for (const channel of BOT_TEXT_CHANNELS) {
        const byLocale = t.settings.bot_texts?.[key]?.[channel];
        if (!byLocale) continue;
        const clean: Partial<Record<Locale, string>> = {};
        for (const l of SUPPORTED_LOCALES) {
          const v = cleanBotText(byLocale[l]);
          if (v) clean[l] = v;
        }
        if (Object.keys(clean).length) custom[channel] = clean;
      }
      return {
        key,
        optIn: OPT_IN.includes(key),
        vars: BOT_TEXT_VARS[key],
        standard: standardOf(key, shopName, t.vertical),
        custom,
      };
    }),
  };
}

/** Свежие настройки: страница могла быть открыта давно, а текст сохраняет другая вкладка. */
async function freshSettings(ctx: TenantContext) {
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  return ((await tenantDirectory(true)).find((x) => x.id === ctx.tenant.id) ?? ctx.tenant).settings;
}

/**
 * Сохранить тексты одного ключа для одного канала. Язык со значением null или
 * пустой строкой — сброс к стандартному. Канал, где текст ещё не подключён,
 * сохранить нельзя: бот его не отправит.
 */
export async function saveBotText(
  ctx: TenantContext,
  input: {
    key: BotTextKey;
    channel: BotTextChannel;
    texts: Partial<Record<Locale, string | null>>;
  },
): Promise<void> {
  if (!WIRED[input.channel].includes(input.key)) return;
  const settings = await freshSettings(ctx);
  const keyObj = { ...(settings.bot_texts?.[input.key] ?? {}) };
  const channelObj: Partial<Record<Locale, string>> = { ...(keyObj[input.channel] ?? {}) };
  for (const l of SUPPORTED_LOCALES) {
    if (!(l in input.texts)) continue;
    const v = cleanBotText(input.texts[l]);
    if (v) channelObj[l] = v;
    else delete channelObj[l];
  }
  if (Object.keys(channelObj).length) keyObj[input.channel] = channelObj;
  else delete keyObj[input.channel];
  const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
  await patchTenantSettings(ctx.tenant.id, {
    bot_texts: { [input.key]: Object.keys(keyObj).length ? keyObj : null },
  });
}

/** Рабочие часы; null — часов нет, текст «вне часов работы» не отправляется. */
export async function saveWorkHours(ctx: TenantContext, hours: unknown): Promise<WorkHours | null> {
  const clean = cleanWorkHours(hours);
  const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
  await patchTenantSettings(ctx.tenant.id, { work_hours: clean });
  return clean;
}
