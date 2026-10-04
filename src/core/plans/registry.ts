import type { ModuleKey } from "@/core/modules/registry";
import type { VerticalKey } from "@/core/verticals/registry";

/**
 * Тарифы платформы: подключение один раз и дальше подписка на план. План —
 * пара «ниша × уровень» (`flowers.pro`), ключ лежит в `bots.settings.billing.plan`.
 * Колонка `bots.subscription_plan` принимает только free/basic/pro/enterprise
 * (ограничение базы, схему не меняем) — туда пишется уровень (`dbPlanFor`).
 * Модули остаются внутренними флагами «функция
 * включена»: план лишь решает, какие флаги стоят в `bots.modules`, так что
 * все проверки `ctx.tenant.modules.*` в коде работают как раньше, и v1,
 * читающий ту же колонку, тоже.
 *
 * Условия утверждены Яковом 26.09.2026: цены одинаковы для всех ниш, сверх
 * плана докупаются только каналы (WhatsApp, Instagram), лимиты ИИ помесячно,
 * годовая оплата — 10 месяцев вместо 12, пробный период 7 дней на Basic:
 * включается сам при регистрации, оператор может продлить вручную.
 * Консультант BOVI (ниша `consultant`) — вне тарифов, по договору: у него
 * план `custom`, модули оператор включает руками, как до тарифов.
 *
 * В планы кладём только готовые модули ("available"). Позиция без кода
 * войдёт в план, когда будет сделана, — тест не даст положить planned.
 */

export const PLAN_TIERS = ["basic", "pro", "business"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** Ниши с тарифами. `consultant` (BOVI) сюда не входит — он по договору. */
export const PLAN_NICHES = [
  "confectionery",
  "flowers",
  "digital",
  "courses",
  "consultant_universal",
] as const;
export type PlanNiche = (typeof PLAN_NICHES)[number];

export type PlanKey = `${PlanNiche}.${PlanTier}`;
/** Индивидуальные условия (BOVI и договорные клиенты): модули — вручную. */
export const CUSTOM_PLAN = "custom";

/**
 * Версия состава планов. Меняется, когда состав или цены планов меняются:
 * клиенту пишется версия, по которой он подключён (`billing.plan_version`),
 * чтобы изменение не меняло его условия молча.
 */
export const PLAN_VERSION = 1;

export const TIER_TITLES: Record<PlanTier, string> = {
  basic: "Basic",
  pro: "Pro",
  business: "Business",
};

/** ₸. Одинаковые для всех ниш. */
export const CONNECTION_PRICE: Record<PlanTier, number> = {
  basic: 15_000,
  pro: 30_000,
  business: 60_000,
};
export const MONTHLY_PRICE: Record<PlanTier, number> = {
  basic: 9_900,
  pro: 19_900,
  business: 39_900,
};
/** Годовая оплата: два месяца в подарок. */
export const ANNUAL_BILLED_MONTHS = 10;
export const TRIAL_DAYS = 7;
/** Продление пробного периода оператором за один раз, дней. */
export const TRIAL_EXTEND_MAX_DAYS = 30;
export const TRIAL_TIER: PlanTier = "basic";

/** Месячные лимиты ИИ; null — без лимита. */
export type PlanLimits = { aiDialogs: number | null; receiptChecks: number | null };
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  basic: { aiDialogs: 300, receiptChecks: 200 },
  pro: { aiDialogs: 1_500, receiptChecks: 1_000 },
  business: { aiDialogs: 5_000, receiptChecks: null },
};

/** Бесплатная часть: во всех планах всех ниш. */
export const BASE_MODULES: readonly ModuleKey[] = [
  "shop",
  "broadcasts",
  "multi_files",
  "order_status",
  "excel_export",
  "legal_docs",
  "dashboard",
];

/**
 * Что добавляет каждый уровень ниши сверх предыдущего. Pro включает всё из
 * Basic, Business — всё из Pro (см. planModules).
 */
export const PLAN_MODULES: Record<PlanNiche, Record<PlanTier, readonly ModuleKey[]>> = {
  confectionery: {
    // Дата и способ получения, зоны, ручной заказ и задаток — в ядре, без флага.
    basic: ["stock"],
    pro: [
      "profit",
      "robokassa",
      "receipt_ocr",
      "coupons",
      "gift_certificates",
      "cart_reminder",
      "review_request",
      "manager_chat",
      "telegram_mini_app",
      "crm_pipeline",
      "giveaways",
    ],
    business: [
      "whatsapp",
      "wa_shop",
      "instagram",
      "dm_shop",
      "loyalty",
      "referral",
      "web_storefront",
      "smart_search",
      "multi_language",
      "multi_currency",
      "admin_roles",
      "crm_integration",
      "helpdesk",
    ],
  },
  flowers: {
    // Покупатели цветов пишут в WhatsApp — он с Basic.
    basic: ["whatsapp", "wa_shop", "stock"],
    pro: [
      "profit",
      "robokassa",
      "receipt_ocr",
      "manager_chat",
      "gift_certificates",
      "coupons",
      "cart_reminder",
      "review_request",
      "crm_pipeline",
      "giveaways",
    ],
    business: [
      "instagram",
      "dm_shop",
      "wa_broadcasts",
      "smart_search",
      "web_storefront",
      "loyalty",
      "referral",
      "multi_currency",
      "helpdesk",
    ],
  },
  digital: {
    basic: [],
    pro: [
      "profit",
      "robokassa",
      "receipt_ocr",
      "coupons",
      "cart_reminder",
      "vip",
      "multi_language",
      "crm_pipeline",
      "giveaways",
    ],
    business: [
      "telegram_mini_app",
      "web_storefront",
      "smart_search",
      "loyalty",
      "referral",
      "gift_certificates",
      "instagram",
      "dm_shop",
      "whatsapp",
      "wa_shop",
      "manager_chat",
      "helpdesk",
    ],
  },
  // Онлайн-школа: вопросы преподавателю — с Basic. Сами «Курсы» с закрытым
  // каналом курса (core/courses/channel.server) — продукт школы: в любом
  // уровне, если их не отложили (planModules, COURSES_SALE = "off"). `vip` —
  // отдельный VIP-бот с платной группой, школе он не нужен и не входит.
  // Цены те же, что у всех ниш (решение Якова 2026-09-26), пока он не назовёт
  // свои для школ.
  courses: {
    basic: ["manager_chat"],
    pro: [
      "profit",
      "robokassa",
      "receipt_ocr",
      "coupons",
      "gift_certificates",
      "cart_reminder",
      "review_request",
      "multi_language",
      "crm_pipeline",
      "giveaways",
    ],
    business: [
      "telegram_mini_app",
      "web_storefront",
      "smart_search",
      "loyalty",
      "referral",
      "instagram",
      "dm_shop",
      "whatsapp",
      "wa_shop",
      "helpdesk",
      "admin_roles",
    ],
  },
  consultant_universal: {
    basic: ["instagram", "manager_chat"],
    // Pro и Business консультанта отличаются глубиной ИИ и лимитом диалогов.
    pro: ["crm_pipeline"],
    business: ["whatsapp", "multi_currency"],
  },
};

/**
 * Как продаётся модуль «Курсы» (courses). Решение Якова 2026-09-27: входит
 * в Pro+ («plan» с Pro), без доплаты. Меняется здесь одной строкой:
 *   plan     — входит в планы ниш с магазином, начиная с COURSES_FROM_TIER;
 *   separate — ни в один план не входит, оператор подключает отдельно
 *              (18 000 ₸ по каталогу модулей, пишется в billing.grandfathered);
 *   off      — не продаём: модуль выключен у всех, даже подключённый вручную.
 */
export type CoursesSale = "plan" | "separate" | "off";
export const COURSES_SALE: CoursesSale = "plan";
export const COURSES_FROM_TIER: PlanTier = "pro";
/** Ниши с магазином; у консультанта нет кассы, курсы ему ни к чему. */
export const COURSES_NICHES: readonly PlanNiche[] = ["digital", "confectionery", "flowers"];

/**
 * С какого уровня план включает «Несколько ботов» (multi_bot), во всех нишах;
 * null — ни в один план, оператор подключает отдельно (billing.grandfathered).
 * Решение за Яковом, до ответа — Business; меняется здесь одной строкой.
 */
export const MULTI_BOT_FROM_TIER: PlanTier | null = "business";

/** Докупаются сверх плана только каналы: у них разная себестоимость. */
export const ADDONS = {
  whatsapp: { title: "WhatsApp", modules: ["whatsapp", "wa_shop"] },
  instagram: { title: "Instagram", modules: ["instagram", "dm_shop"] },
} as const satisfies Record<string, { title: string; modules: readonly ModuleKey[] }>;
export type AddonKey = keyof typeof ADDONS;
export const ADDON_KEYS = Object.keys(ADDONS) as AddonKey[];

/** Надбавка за канал сверх плана, ₸ в месяц (решение Якова 2026-09-26). */
export const ADDON_MONTHLY_PRICE: Record<AddonKey, number> = { whatsapp: 5000, instagram: 5000 };

/** Модули магазина в каналах — консультанту (без кассы) не включаются. */
export const SHOP_CHANNEL_MODULES: readonly ModuleKey[] = ["wa_shop", "dm_shop"];

/**
 * Тарифная ниша магазина по его вертикали. Школы, уже подключённые по плану
 * `digital.*`, остаются на нём: план в базе сам не меняется, новая ниша
 * действует при новом выборе плана и пробном периоде.
 */
export function nicheForVertical(v: VerticalKey): PlanNiche | null {
  return (PLAN_NICHES as readonly string[]).includes(v) ? (v as PlanNiche) : null;
}

export function planKey(niche: PlanNiche, tier: PlanTier): PlanKey {
  return `${niche}.${tier}`;
}

export type ParsedPlan =
  { kind: "tier"; key: PlanKey; niche: PlanNiche; tier: PlanTier } | { kind: "custom" } | null;

/**
 * Значения, которые база принимает в `bots.subscription_plan` (CHECK в схеме
 * общей с v1 базы). Ключ плана с нишей туда не помещается.
 */
export const DB_PLAN_VALUES = ["free", "basic", "pro", "enterprise"] as const;
export type DbPlan = (typeof DB_PLAN_VALUES)[number];

const DB_PLAN_BY_TIER: Record<PlanTier, DbPlan> = {
  basic: "basic",
  pro: "pro",
  business: "enterprise",
};

/** Что записать в `bots.subscription_plan` для плана: уровень; индивидуальные условия — enterprise. */
export function dbPlanFor(plan: string): DbPlan {
  const p = parsePlan(plan);
  return p?.kind === "tier" ? DB_PLAN_BY_TIER[p.tier] : "enterprise";
}

/** Разбор ключа плана (`settings.billing.plan`); незнакомое значение — null. */
export function parsePlan(raw: string | null | undefined): ParsedPlan {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v === CUSTOM_PLAN) return { kind: "custom" };
  const [niche, tier] = v.split(".");
  if (
    (PLAN_NICHES as readonly string[]).includes(niche ?? "") &&
    (PLAN_TIERS as readonly string[]).includes(tier ?? "")
  )
    return {
      kind: "tier",
      key: v as PlanKey,
      niche: niche as PlanNiche,
      tier: tier as PlanTier,
    };
  return null;
}

export function planTitle(raw: string | null | undefined, nicheTitle?: string): string {
  const p = parsePlan(raw);
  if (!p) return "без плана";
  if (p.kind === "custom") return "Индивидуальный (по договору)";
  return `${nicheTitle ? `${nicheTitle} · ` : ""}${TIER_TITLES[p.tier]}`;
}
