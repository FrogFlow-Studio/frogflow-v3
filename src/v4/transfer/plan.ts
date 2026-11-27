import type { ConsultantProfile } from "@/core/consultant/profile";
import type { KnowledgeDoc } from "@/core/consultant/knowledge";
import type { SellerProfile } from "../seller/prompt";
import type { SellerFeatures } from "../seller/role";

/**
 * Перенос ИИ-продавца v3 → v4 (Спецификация, раздел 3). Чистая функция: из
 * снимка v3 — что записать в v4 и отчёт «проверить». Правило: каждое поле
 * либо переносится, либо попадает в отчёт с причиной; молча не теряется ничего.
 * Запись — `applyTransfer` (apply.ts), повторный запуск ничего не задваивает.
 */

export type V3Snapshot = {
  /** app_settings.consultant_profile, разобранный parseProfile v3; null — не заполнен. */
  profile: ConsultantProfile | null;
  /** app_settings.consultant_knowledge. */
  knowledge: KnowledgeDoc[];
  /** Сырые значения app_settings: consultant_enabled, chat_*, *_ai, *_daily_usd. */
  settings: Record<string, string | null | undefined>;
  /** app_settings.ai_balance.usd; null — ключа нет. */
  balanceUsd: number | null;
  /** Товары уже в v4 (после copy_from_public): id v4, название, вариант, описание, ключевые слова. */
  products: Array<{
    id: string;
    title: string;
    variantLabel: string | null;
    description: string | null;
    keywords: string[];
  }>;
  /** public.products и product_images v3 (id те же, что в v4): описание, ключевые слова, фото (пути Storage). */
  v3Products: Array<{ id: string; description: string | null; keywords: string[]; photos: string[] }>;
  /** state.consultant.recent по покупателям Telegram. */
  histories: Array<{
    telegramId: string;
    recent: Array<{ role: "customer" | "assistant"; text: string }>;
  }>;
  /** blocked_users: telegram_id. */
  blockedTelegramIds: string[];
};

export type ReportLine = { area: string; item: string; reason: string };

export type TransferPlan = {
  profile: SellerProfile;
  defaultLang: "ru" | "kk" | "en";
  features: SellerFeatures;
  knowledge: Array<{ question: string; answer: string; needsReview: boolean }>;
  productTexts: Array<{
    productId: string;
    description: string | null;
    keywords: string[];
    photos: string[];
  }>;
  balanceUsd: number | null;
  histories: Array<{
    telegramId: string;
    messages: Array<{ direction: "in" | "out"; text: string }>;
  }>;
  blockedTelegramIds: string[];
  report: ReportLine[];
};

export const HISTORY_PER_BUYER = 24;

const TONE_WORDS: Record<ConsultantProfile["tone"], string> = {
  friendly_expert: "дружелюбный эксперт",
  formal: "деловой и сдержанный",
  luxury_warm: "премиальный и тёплый",
  casual: "лёгкий, на «ты»",
};

/** Строка указаний, которая в v4 спорит с правилами роли или кода. */
const RISKY_INSTRUCTION =
  /оформляем|оформить заказ\?|спрашивай страну|спроси страну|скидк|\d[\d\s]*(₸|тг|тенге|руб|₽|\$|сом|сум)|\d+\s*(дн|час|мин|недел)/iu;

const CONTACT = /[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s()-]{8,}\d/u;

const on = (v: string | null | undefined) => v?.trim().toLowerCase() === "true";
const usd = (v: string | null | undefined) => {
  const n = Number(v);
  return v != null && v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

const norm = (s: string) => s.toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();

export function planTransfer(v3: V3Snapshot): TransferPlan {
  const report: ReportLine[] = [];
  const p = v3.profile;

  // ── Анкета ──
  const profile: SellerProfile = {};
  const about: string[] = [];
  if (p) {
    if (p.brand_name) profile.shop_name = p.brand_name;
    if (p.about) about.push(p.about.trim());
    if (p.website_url) about.push(`Сайт: ${p.website_url.trim()}`);
    if (p.payment_info) profile.payment_terms = p.payment_info.trim();
    if (p.delivery_info) profile.delivery_terms = p.delivery_info.trim();
    profile.tone = TONE_WORDS[p.tone];
    if (p.custom_instructions) {
      const kept: string[] = [];
      for (const line of p.custom_instructions
        .split(/\n+/u)
        .map((x) => x.trim())
        .filter(Boolean)) {
        if (RISKY_INSTRUCTION.test(line))
          report.push({
            area: "анкета",
            item: `указание «${line.slice(0, 120)}»`,
            reason:
              "спорит с правилами v4 (оформление кнопкой, страна, скидка, цена или срок цифрой) — не перенесено",
          });
        else kept.push(line);
      }
      if (kept.length) about.push(`Указания продавца:\n${kept.join("\n")}`);
    }
    if (p.goal !== "direct_sales")
      report.push({ area: "анкета", item: `цель «${p.goal}»`, reason: "в v4 цель одна — продажа" });
    if (p.medical_disclaimer)
      report.push({
        area: "анкета",
        item: "медицинская оговорка",
        reason: "в v4 нет — проверить вручную",
      });
    if (p.countries.length || p.currency)
      report.push({
        area: "анкета",
        item: `страны ${p.countries.join(", ") || "—"}, валюта ${p.currency || "—"}`,
        reason: "в v4 цены по странам в каталоге — сверить с каталогом",
      });
  } else {
    report.push({
      area: "анкета",
      item: "анкета v3",
      reason: "не заполнена — оценка готовности покажет пустые поля",
    });
  }

  // ── Знания ──
  const knowledge: TransferPlan["knowledge"] = [];
  const productTexts = new Map<string, TransferPlan["productTexts"][number]>();
  // Карточка товара v3 (описание, ключевые слова, фото) — раньше статей знаний:
  // её писал продавец про этот товар. Фото — пути Storage, файлы не копируются.
  const inV4 = new Map(v3.products.map((x) => [x.id, x]));
  let lostProducts = 0;
  for (const vp of v3.v3Products) {
    const prod = inV4.get(vp.id);
    const description = vp.description?.trim() || null;
    const keywords = [...new Set(vp.keywords.map((k) => k.trim()).filter(Boolean))];
    const photos = [...new Set(vp.photos.filter(Boolean))];
    if (!description && !keywords.length && !photos.length) continue;
    if (!prod) {
      lostProducts++;
      continue;
    }
    productTexts.set(prod.id, {
      productId: prod.id,
      description: prod.description ? null : description?.slice(0, 4000) || null,
      keywords,
      photos,
    });
  }
  if (lostProducts)
    report.push({
      area: "товары",
      item: `${lostProducts} товаров v3 с описанием или фото`,
      reason: "нет в каталоге v4 (не перенесены copy_from_public) — карточки не перенесены",
    });
  const titleOf = (x: V3Snapshot["products"][number]) =>
    norm(x.title + (x.variantLabel ? ` ${x.variantLabel}` : ""));
  for (const doc of v3.knowledge) {
    const title = doc.title.trim();
    const content = doc.content.trim();
    if (!title || !content) {
      report.push({
        area: "знания",
        item: `статья «${title || doc.id}»`,
        reason: "пустое название или текст — не перенесена",
      });
      continue;
    }
    const cat = norm(doc.category ?? "");
    if (/оплат|payment/u.test(cat) && !profile.payment_terms) {
      profile.payment_terms = content;
      continue;
    }
    if (/доставк|выдач|delivery/u.test(cat) && !profile.delivery_terms) {
      profile.delivery_terms = content;
      continue;
    }
    const keys = [title, ...(doc.tags ?? [])].map(norm).filter(Boolean);
    const matched = v3.products.filter((x) =>
      keys.some((k) => titleOf(x) === k || norm(x.title) === k),
    );
    const contact = CONTACT.test(content);
    if (matched.length === 1 && !contact) {
      const prod = matched[0]!;
      const cur = productTexts.get(prod.id) ?? {
        productId: prod.id,
        description: null,
        keywords: [],
        photos: [],
      };
      if (!prod.description && !cur.description) cur.description = content.slice(0, 4000);
      else
        knowledge.push({
          question: title.slice(0, 1000),
          answer: content.slice(0, 4000),
          needsReview: false,
        });
      cur.keywords = [
        ...new Set([...cur.keywords, ...(doc.tags ?? []).map((t) => t.trim()).filter(Boolean)]),
      ];
      productTexts.set(prod.id, cur);
      continue;
    }
    const review = matched.length > 1 || contact;
    knowledge.push({
      question: title.slice(0, 1000),
      answer: content.slice(0, 4000),
      needsReview: review,
    });
    if (review)
      report.push({
        area: "знания",
        item: `статья «${title.slice(0, 80)}»`,
        reason: contact
          ? "внутри телефон или почта — на проверке у продавца"
          : "подходит к нескольким товарам — на проверке",
      });
  }
  if (about.length) profile.about = about.join("\n\n").slice(0, 2000);

  // ── Флажки ИИ ──
  const s = v3.settings;
  const features: SellerFeatures = { buyer: on(s.consultant_enabled) };
  const triageSwitches: Record<string, string> = {};
  for (const [k, v] of Object.entries(s))
    if (k.startsWith("chat_") && typeof v === "string") triageSwitches[k] = v;
  const triageCap = usd(s.inbox_triage_daily_usd);
  features.triage = triageCap !== null && triageCap > 0;
  if (Object.keys(triageSwitches).length) features.triage_switches = triageSwitches;
  if (triageCap !== null) features.triage_daily_usd = triageCap;
  features.country = on(s.country_ai);
  const countryCap = usd(s.country_ai_daily_usd);
  if (countryCap !== null) features.country_daily_usd = countryCap;
  features.postpay = on(s.postpay_ai);
  const postpayCap = usd(s.postpay_ai_daily_usd);
  if (postpayCap !== null) features.postpay_daily_usd = postpayCap;

  // ── История и блок ──
  const histories = v3.histories
    .map((h) => ({
      telegramId: h.telegramId,
      messages: h.recent
        .slice(-HISTORY_PER_BUYER)
        .map((m) => ({
          direction: m.role === "customer" ? ("in" as const) : ("out" as const),
          text: m.text.slice(0, 8000),
        }))
        .filter((m) => m.text.trim()),
    }))
    .filter((h) => h.messages.length);
  if (v3.balanceUsd === null)
    report.push({ area: "кошелёк", item: "ai_balance", reason: "ключа нет — переносить нечего" });

  return {
    profile,
    defaultLang: p?.primary_language ?? "ru",
    features,
    knowledge,
    productTexts: [...productTexts.values()],
    balanceUsd: v3.balanceUsd,
    histories,
    blockedTelegramIds: [...new Set(v3.blockedTelegramIds.map(String))],
    report,
  };
}
