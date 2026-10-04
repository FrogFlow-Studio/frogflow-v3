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

export const DIRECT_BOT_SUFFIXES = [
  "enabled",
  "scope",
  "triggers",
  "script",
  "features",
  "seller_pause",
  // только WhatsApp
  "ignore_excluded_contacts",
  "notify_template",
] as const;

export type DirectBotFeatures = {
  catalog: boolean;
  search: boolean;
  cart: boolean;
  checkout: boolean;
};

/** Сколько бот молчит после реплики продавца руками: минуты или «до конца дня» (Б3). */
export const SELLER_PAUSES = ["15", "30", "60", "day"] as const;
export type SellerPause = (typeof SELLER_PAUSES)[number];

export type DirectBotSettings = {
  sellerPause: SellerPause;
  enabled: boolean;
  scope: "purchases" | "all";
  triggers: string[];
  script: string;
  features: DirectBotFeatures;
  /** WhatsApp: не отвечать номерам из списка исключений (`whatsapp_bot_excluded_phones`). */
  ignoreExcluded: boolean;
  /** WhatsApp: одобренный шаблон «имя:язык» для уведомлений вне 24-часового окна. */
  notifyTemplate: string;
};

export const DEFAULT_DIRECT_BOT: DirectBotSettings = {
  enabled: true,
  scope: "purchases",
  triggers: [],
  script: "",
  features: { catalog: true, search: true, cart: true, checkout: true },
  sellerPause: "30",
  ignoreExcluded: false,
  notifyTemplate: "",
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
    sellerPause: (SELLER_PAUSES as readonly string[]).includes(v("seller_pause"))
      ? (v("seller_pause") as SellerPause)
      : "30",
    ignoreExcluded: v("ignore_excluded_contacts") === "true",
    notifyTemplate: v("notify_template"),
  };
}

/** Покупатель написал слово-вызов из настроек продавца (целиком, без учёта регистра и знаков). */
export function isTriggerWord(text: string, triggers: readonly string[]): boolean {
  if (!triggers.length) return false;
  const n = normalizeWord(text);
  return Boolean(n) && triggers.includes(n);
}

/**
 * Нажатие кнопки, которое должно открыть магазин с начала: скрытый payload
 * «/start» (его ставит normalizeDmButtons кнопке без своего payload — так
 * устроены кнопки «Купить» в автоматизациях Instagram) или слово-вызов
 * продавца. Подпись кнопки, которую видно в чате, роли не играет. Кнопки
 * чужих автоматизаций Zernio (`ACT::…`) — не наши.
 */
export function isStartPostback(payload: string | null | undefined, triggers: readonly string[]) {
  const p = (payload ?? "").trim();
  if (!p || p.startsWith("ACT::")) return false;
  const n = normalizeWord(p);
  return n === "/start" || n === "start" || isTriggerWord(p, triggers);
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
  await setSetting(ctx, `${p}seller_pause`, s.sellerPause);
  if (platform === "whatsapp") {
    await setSetting(ctx, `${p}ignore_excluded_contacts`, s.ignoreExcluded ? "true" : "false");
    await setSetting(ctx, `${p}notify_template`, s.notifyTemplate.trim());
  }
}
