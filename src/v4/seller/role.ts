import { serverFailure } from "@/lib/server-failure";
import { conversationHistory, rememberFact } from "../agent/conversation";
import { type AgentRole, detectLang, type RoleSession, type TurnArgs } from "../agent/run";
import type { V4Db } from "../core/db";
import { handToSeller } from "../core/cases/cases";
import { createOffer } from "./offers";
import { buildSellerSystem, type Knowledge, parseProfile, profileText } from "./prompt";
import {
  acceptLastOffer,
  formatMoney,
  numbersIn,
  offerLabel,
  runSellerTool,
  SELLER_TOOLS,
  type SellerTurn,
} from "./tools";
import { asLang, BUYER_LANGS, type BuyerLang, TEXTS } from "./texts";

/**
 * Роль «продавец» на ядре ИИ-сотрудника (src/v4/agent/run.ts). Ядро решает
 * порядок ответа, деньги и проверку; роль — что знает магазин, какие у неё
 * инструменты и что сказать без ИИ.
 *
 * ИИ — дополнение магазина (shops.ai_features.buyer). Выключено — ядро молчит
 * (ai_off), и канал ведёт себя как v3: роль не придумывает свой путь без ИИ.
 */

export type SellerFeatures = {
  buyer?: boolean;
  triage?: boolean;
  country?: boolean;
  postpay?: boolean;
  objections?: boolean;
  upsell?: boolean;
  model?: "standard" | "fast";
  daily_cap_micro_usd?: number | null;
  max_chars?: number;
  prompt_variant?: string;
  /** Переключатели разбора входящих из v3 (chat_*), как есть; сам разбор — этап 2. */
  triage_switches?: Record<string, string>;
  triage_daily_usd?: number;
  country_daily_usd?: number;
  postpay_daily_usd?: number;
};

type ContextRow = {
  profile: unknown;
  features: SellerFeatures;
  local_time: string;
  weekday: number;
  base_currency: string;
  wallet_micro_usd: number | string;
  country: string | null;
  language: string;
  facts: Record<string, string>;
  knowledge_total: number;
  knowledge: Knowledge[];
  open_orders: Array<{
    no: number;
    total_minor: number | string;
    paid_minor: number | string;
    currency: string;
    money_state: string;
  }>;
  prices_minor: Array<number | string>;
  auto_cap_micro_usd: number | string | null;
  payment_details: string[];
};

export async function sellerContext(
  db: V4Db,
  a: { botId: string; buyerId: string; query?: string; now?: Date },
): Promise<ContextRow> {
  const r = (
    await db.call("seller_context_v2", {
      p_bot_id: a.botId,
      p_buyer_id: a.buyerId,
      p_query: a.query ?? "",
      ...(a.now ? { p_now: a.now.toISOString() } : {}),
    })
  )[0]?.seller_context_v2 as ContextRow | null | undefined;
  if (!r) throw serverFailure("v4.seller_context_v2: магазина нет");
  return r;
}

/** Язык и страна покупателя на этот ход — инструменты их меняют (set_country). */
const turns = new WeakMap<RoleSession, SellerTurn>();
const turnOf = (s: RoleSession, fallback: SellerTurn) => {
  let t = turns.get(s);
  if (!t) {
    t = { ...fallback };
    turns.set(s, t);
  }
  return t;
};

/**
 * Язык, на котором бот не отвечает (F07): кыргызские ң, ө, ү без казахских
 * ә, ғ, қ, һ, і, ұ. Бот пишет по-русски и просит писать по-русски или по-казахски.
 */
export function isOtherLanguage(text: string): boolean {
  return /[ңөү]/iu.test(text) && !/[әғқһіұ]/iu.test(text);
}

/** «Продавец ответит» — не чаще раза в 6 часов: покупатель не получает его на каждое сообщение. */
export const HOLD_REPEAT_MS = 6 * 3_600_000;

export function sellerRole(): AgentRole {
  // Страна и язык последнего loadContext — на случай, если сессия ещё не видела инструментов.
  const base = new Map<string, SellerTurn>();
  const key = (a: TurnArgs) => `${a.botId}:${a.buyerId}`;

  return {
    purpose: "seller",
    tools: SELLER_TOOLS,

    async loadContext(db, a) {
      const c = await sellerContext(db, { ...a, query: a.text });
      const profile = parseProfile(c.profile);
      const features = c.features ?? {};
      const other = isOtherLanguage(a.text);
      const lang = other ? "ru" : (detectLang(a.text, asLang(c.language)) as BuyerLang);
      base.set(key(a), { country: c.country, lang });
      // Язык по сообщению запоминается (B05): следующий короткий ответ («да», «5 класс») — на нём же.
      const said = other ? "other" : lang;
      const letters = (a.text.match(/\p{L}/gu) ?? []).length;
      if (a.mode !== "shadow" && letters >= 8 && (c.facts?.language ?? c.language) !== said)
        await rememberFact(db, {
          botId: a.botId,
          buyerId: a.buyerId,
          key: "language",
          value: said,
          source: "buyer",
          ...(a.now ? { now: a.now } : {}),
        });
      const shopText = [profileText(profile), ...c.knowledge.map((k) => k.answer)].join("\n");
      const units = (m: number | string) => Number(m) / 100;
      return {
        aiEnabled: features.buyer === true,
        lang,
        sources: Object.fromEntries(
          c.knowledge.flatMap((k, i) => (k.id ? [[`K${i + 1}`, k.id] as const] : [])),
        ),
        system: buildSellerSystem({
          profile,
          knowledge: c.knowledge,
          knowledgeTotal: Number(c.knowledge_total),
          features,
          buyer: {
            country: c.country,
            facts: c.facts ?? {},
            openOrders: c.open_orders.map(
              (o) =>
                `№${o.no} на ${formatMoney(Number(o.total_minor), o.currency)}, оплачено ${formatMoney(Number(o.paid_minor), o.currency)}`,
            ),
            localTime: c.local_time,
            weekday: Number(c.weekday),
            ...(a.context ? { context: a.context } : {}),
            ...(a.voice ? { voice: true } : {}),
            otherLanguage: other,
          },
          lang,
        }),
        // Предел дня: из флажков, иначе 3 средних дня магазина (E06).
        dailyCapMicroUsd:
          typeof features.daily_cap_micro_usd === "number"
            ? features.daily_cap_micro_usd
            : c.auto_cap_micro_usd == null
              ? null
              : Number(c.auto_cap_micro_usd),
        ...(features.max_chars ? { maxChars: features.max_chars } : {}),
        promptVariant: features.prompt_variant ?? null,
        check: {
          prices: c.prices_minor.map(units),
          allowedNumbers: [
            ...numbersIn(shopText),
            ...c.open_orders.flatMap((o) => [
              Number(o.no),
              units(o.total_minor),
              units(o.paid_minor),
            ]),
          ],
          shopText,
          deliveryTerms: profile.delivery_terms ?? "",
          quoted: profile.shop_name ? [profile.shop_name] : [],
          allowedContacts: [profileText(profile), ...c.payment_details].filter(Boolean),
        },
      };
    },

    async shortcut(db, s, a) {
      if (a.text.trim() !== "+") return null;
      const lang = asLang(a.lang);
      const r = await acceptLastOffer(db, a, { strict: true });
      if (r.kind === "order") {
        s.actions.push({ kind: "order_created", orderId: r.orderId, orderNo: r.orderNo });
        return { text: TEXTS.ordered[lang].replace("{no}", String(r.orderNo)) };
      }
      if (r.kind === "new_offer") {
        s.buttons.push({
          offerId: r.offer.offerId,
          label: offerLabel(
            lang,
            r.offer.items.map((i) => i.title),
            formatMoney(r.offer.totalMinor, r.offer.currency),
          ),
        });
        return { text: TEXTS.newPrice[lang] };
      }
      return null;
    },

    buttonOnlyText: (lang) => TEXTS.tapBuy[asLang(lang)],

    runTool(db, s, a, name, input) {
      const t = turnOf(s, base.get(key(a)) ?? { country: null, lang: "ru" });
      return runSellerTool(db, s, a, t, name, input);
    },

    async fallback(db, s, a, reason) {
      const lang = (BUYER_LANGS as readonly string[]).includes(a.lang)
        ? (a.lang as BuyerLang)
        : "ru";
      const c = await sellerContext(db, { ...a, query: a.text });
      const note = parseProfile(c.profile).work_hours_note;
      const withNote = (t: string) => (note ? `${t} ${note}` : t);

      if (reason === "check_failed" && a.mode === "shadow") return { text: TEXTS.handedOff[lang] };
      if (reason === "check_failed") {
        // Модель дважды написала то, что нельзя отправить: вопрос — продавцу.
        const caseId = await handToSeller(db, {
          botId: a.botId,
          buyerId: a.buyerId,
          reason: `Бот не смог ответить сам: ${a.text.slice(0, 200)}`,
          by: "bot",
        });
        s.handedOff = true;
        s.actions.push({ kind: "handoff", caseId, reason: "check_failed" });
        return { text: withNote(TEXTS.handedOff[lang]) };
      }

      // Без модели: товары по словам покупателя с кнопками, иначе «продавец ответит».
      const hasWords = /[\p{L}\p{N}]{3,}/u.test(a.text);
      if (hasWords) {
        const rows = await db.call("find_products", {
          p_bot_id: a.botId,
          p_query: a.text,
          p_limit: 8,
        });
        for (const r of rows.filter((x) => !x.has_variants).slice(0, 3)) {
          const o = await createOffer(db, {
            botId: a.botId,
            buyerId: a.buyerId,
            productIds: [String(r.product_id)],
            mode: a.mode,
            ...(a.now ? { now: a.now } : {}),
          });
          if (!o.ok) continue;
          s.buttons.push({
            offerId: o.offer.offerId,
            label: offerLabel(
              lang,
              o.offer.items.map((i) => i.title),
              formatMoney(o.offer.totalMinor, o.offer.currency),
            ),
          });
        }
      }
      if (s.buttons.length) return { text: TEXTS.found[lang] };
      if (await holdSentRecently(db, a)) return { text: "" };
      return { text: withNote(TEXTS.hold[lang]) };
    },
  };
}

/** Был ли «продавец ответит» этому покупателю за последние 6 часов. */
async function holdSentRecently(db: V4Db, a: TurnArgs): Promise<boolean> {
  const hist = await conversationHistory(db, {
    botId: a.botId,
    buyerId: a.buyerId,
    mode: a.mode,
    limit: 20,
  });
  const now = (a.now ?? new Date()).getTime();
  const holds = BUYER_LANGS.map((l) => TEXTS.hold[l]);
  return hist.some(
    (m) =>
      m.direction === "out" &&
      now - new Date(m.createdAt).getTime() < HOLD_REPEAT_MS &&
      holds.some((h) => m.text.startsWith(h)),
  );
}
