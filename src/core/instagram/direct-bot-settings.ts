import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettings, setSetting } from "@/core/settings/settings";

/**
 * Настройки автоответчика в Instagram Direct и WhatsApp — свои у каждого
 * канала, ключи те же, что в v1 (`instagram_direct_bot_*` / `whatsapp_bot_*`):
 * клиент переезжает с настройками, а не с пустой формой. `enabled` —
 * тумблер магазинного сценария (консультант его не читает); `scope` —
 * «только по заказам» (по обычной переписке бот молчит: ответ пометил бы
 * диалог прочитанным, и продавец в приложении перестал бы видеть, кому
 * ответить) или «на все сообщения»; `triggers` — слова покупателя, с
 * которых начинается магазин, сверх встроенных команд; `script` — ответ на
 * короткое или непонятное сообщение вместо стандартного; `features` —
 * что из магазина включено.
 */
export type DirectBotPlatform = "instagram" | "whatsapp";

export const DIRECT_BOT_PREFIX: Record<DirectBotPlatform, string> = {
  instagram: "instagram_direct_bot_",
  whatsapp: "whatsapp_bot_",
};

export const DIRECT_BOT_SUFFIXES = ["enabled", "scope", "triggers", "script", "features"] as const;

export type DirectBotFeatures = {
  catalog: boolean;
  search: boolean;
  cart: boolean;
  checkout: boolean;
};

export type DirectBotSettings = {
  enabled: boolean;
  scope: "purchases" | "all";
  triggers: string[];
  script: string;
  features: DirectBotFeatures;
};

export const DEFAULT_DIRECT_BOT: DirectBotSettings = {
  enabled: true,
  scope: "purchases",
  triggers: [],
  script: "",
  features: { catalog: true, search: true, cart: true, checkout: true },
};

export function directBotSettingKeys(platform: DirectBotPlatform): string[] {
  return DIRECT_BOT_SUFFIXES.map((s) => `${DIRECT_BOT_PREFIX[platform]}${s}`);
}

/** Слова-вызовы из настройки: через запятую, точку с запятой или с новой строки. */
export function parseTriggerWords(raw: string | null | undefined): string[] {
  return Array.from(
    new Set(
      (raw ?? "")
        .split(/[,;\n]+/)
        .map((w) => normalizeWord(w))
        .filter(Boolean),
    ),
  );
}

function normalizeWord(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/^[«"]+|[»"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFeatures(raw: string | null | undefined): DirectBotFeatures {
  const out = { ...DEFAULT_DIRECT_BOT.features };
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object")
      for (const k of Object.keys(out) as (keyof DirectBotFeatures)[])
        if (typeof parsed[k] === "boolean") out[k] = parsed[k] as boolean;
  } catch {
    /* мусор в настройке — значения по умолчанию */
  }
  return out;
}

export function directBotSettingsFrom(
  values: Record<string, string | null | undefined>,
  platform: DirectBotPlatform,
): DirectBotSettings {
  const v = (suffix: (typeof DIRECT_BOT_SUFFIXES)[number]) =>
    (values[`${DIRECT_BOT_PREFIX[platform]}${suffix}`] ?? "").trim();
  return {
    enabled: v("enabled") !== "false",
    scope: v("scope") === "all" ? "all" : "purchases",
    triggers: parseTriggerWords(v("triggers")),
    script: v("script"),
    features: parseFeatures(v("features")),
  };
}

/** Покупатель написал слово-вызов из настроек продавца (целиком, без учёта регистра и знаков). */
export function isTriggerWord(text: string, triggers: readonly string[]): boolean {
  if (!triggers.length) return false;
  const n = normalizeWord(text);
  return Boolean(n) && triggers.includes(n);
}

export async function loadDirectBotSettings(
  ctx: TenantContext,
  platform: DirectBotPlatform,
): Promise<DirectBotSettings> {
  return directBotSettingsFrom(await getSettings(ctx, directBotSettingKeys(platform)), platform);
}

export async function saveDirectBotSettings(
  ctx: TenantContext,
  platform: DirectBotPlatform,
  s: DirectBotSettings,
): Promise<void> {
  const p = DIRECT_BOT_PREFIX[platform];
  await setSetting(ctx, `${p}enabled`, s.enabled ? "true" : "false");
  await setSetting(ctx, `${p}scope`, s.scope);
  await setSetting(ctx, `${p}triggers`, s.triggers.join(", "));
  await setSetting(ctx, `${p}script`, s.script.trim());
  await setSetting(ctx, `${p}features`, JSON.stringify(s.features));
}
