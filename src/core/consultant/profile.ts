/** Профиль бизнеса для ИИ-консультанта — то, что продавец заполняет в админке. */

export const GOALS = ["direct_sales", "book_call", "booking", "expert_faq"] as const;
export type Goal = (typeof GOALS)[number];
export const TONES = ["friendly_expert", "formal", "luxury_warm", "casual"] as const;
export type Tone = (typeof TONES)[number];

export type ConsultantProfile = {
  brand_name: string;
  goal: Goal;
  tone: Tone;
  primary_language: "ru" | "kk" | "en";
  countries: string[];
  currency: string;
  website_url?: string;
  delivery_info?: string;
  payment_info?: string;
  /** Что продаём / чем занимаемся — двумя-тремя предложениями. */
  about?: string;
  /** Особые указания владельца: что говорить, чего не обещать. */
  custom_instructions?: string;
  medical_disclaimer?: boolean;
};

export const GOAL_LABELS: Record<Goal, string> = {
  direct_sales: "Продажа: довести до заказа",
  book_call: "Квалификация и созвон",
  booking: "Запись на услугу или визит",
  expert_faq: "Ответы по базе знаний",
};

export const TONE_LABELS: Record<Tone, string> = {
  friendly_expert: "Дружелюбный эксперт",
  formal: "Деловой и сдержанный",
  luxury_warm: "Премиальный и тёплый",
  casual: "Лёгкий, на «ты»",
};

export function defaultProfile(shopName: string): ConsultantProfile {
  return {
    brand_name: shopName,
    goal: "direct_sales",
    tone: "friendly_expert",
    primary_language: "ru",
    countries: ["KZ"],
    currency: "KZT",
  };
}

export function parseProfile(raw: string | null | undefined, shopName: string): ConsultantProfile {
  const base = defaultProfile(shopName);
  if (!raw?.trim()) return base;
  try {
    const p = JSON.parse(raw) as Partial<ConsultantProfile>;
    return {
      brand_name: String(p.brand_name ?? "").trim() || base.brand_name,
      goal: GOALS.includes(p.goal as Goal) ? (p.goal as Goal) : base.goal,
      tone: TONES.includes(p.tone as Tone) ? (p.tone as Tone) : base.tone,
      primary_language: ["ru", "kk", "en"].includes(String(p.primary_language))
        ? (p.primary_language as ConsultantProfile["primary_language"])
        : base.primary_language,
      countries:
        Array.isArray(p.countries) && p.countries.length ? p.countries.map(String) : base.countries,
      currency:
        String(p.currency ?? "")
          .trim()
          .toUpperCase() || base.currency,
      website_url: p.website_url?.trim() || undefined,
      delivery_info: p.delivery_info?.trim() || undefined,
      payment_info: p.payment_info?.trim() || undefined,
      about: p.about?.trim() || undefined,
      custom_instructions: p.custom_instructions?.trim() || undefined,
      medical_disclaimer: Boolean(p.medical_disclaimer),
    };
  } catch {
    return base;
  }
}
