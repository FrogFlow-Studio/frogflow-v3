import type Anthropic from "@anthropic-ai/sdk";
import type { RoleSession, TurnArgs } from "../agent/run";
import { FACT_KEYS, rememberFact } from "../agent/conversation";
import type { V4Db } from "../core/db";
import { cantPay, handToSeller } from "../core/cases/cases";
import { methodsFor } from "../core/money/money";
import { issueCabinetLink } from "../core/access/access";
import { createOffer } from "./offers";
import { asLang, type BuyerLang, TEXTS } from "./texts";

/**
 * Инструменты роли «продавец» (Спецификация, раздел 3.3). Заказ модель сама
 * не создаёт: она показывает предложение с кнопкой «Купить» (решение 8, Д1),
 * заказ создаёт нажатие (`pressBuy`). Имена — с подчёркиванием: проверка
 * «утечки» ищет их в тексте, а «offer» или «remember» встречаются в обычном
 * английском ответе.
 *
 * Ответ инструмента — JSON для модели; ошибка ввода — тоже ответ, не исключение.
 * Каждый результат дополняет сессию: названия можно цитировать (язык не
 * спотыкается), числа и контакты из результата проверка ответа знает.
 */

export const MAX_OFFERS_PER_REPLY = 2;
export const HANDOFF_KINDS = [
  "human",
  "question",
  "complaint",
  "payment",
  "custom",
  "other",
] as const;
export const HANDOFF_SUMMARY_MAX = 300;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
});

export const SELLER_TOOLS: Anthropic.Tool[] = [
  {
    name: "find_products",
    description:
      "Найти товары по словам покупателя (основа слова: «папку» найдёт «Папка»). Возвращает id, название, вариант, цену для страны покупателя. has_variants — сначала спроси, какой вариант.",
    input_schema: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "product_card",
    description:
      "Карточка товара: описание, что входит, варианты с ценами, что берут вместе. Для вопросов о товаре.",
    input_schema: obj({ product_id: { type: "string" } }, ["product_id"]),
  },
  {
    name: "show_offer",
    description:
      "Показать под ответом кнопку «Купить» на один или несколько товаров (до 10, одна кнопка на сумму). Цена фиксируется на 72 часа. Не больше 2 предложений в ответе.",
    input_schema: obj(
      { product_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 } },
      ["product_ids"],
    ),
  },
  {
    name: "payment_methods",
    description: "Чем покупатель из своей страны может заплатить и как это происходит.",
    input_schema: obj({}),
  },
  {
    name: "order_status",
    description:
      "Открытые заказы покупателя: номер, сумма, сколько оплачено, ждёт ли чек проверки.",
    input_schema: obj({}),
  },
  {
    name: "cancel_order",
    description:
      "Отменить заказ покупателя по номеру. Только если покупатель сам ясно попросил отменить именно этот заказ. Оплаченный или с чеком на проверке не отменяется.",
    input_schema: obj({ order_no: { type: "integer" } }, ["order_no"]),
  },
  {
    name: "cabinet_link",
    description:
      "Покупатель потерял файл или доступ к купленному: система приложит к ответу кнопку его кабинета. Ссылку сам не пиши.",
    input_schema: obj({}),
  },
  {
    name: "cant_pay",
    description:
      "Хочет купить, но не может заплатить ни одним способом. Продавец получит дело с причиной.",
    input_schema: obj({ reason: { type: "string" } }, ["reason"]),
  },
  {
    name: "hand_to_seller",
    description:
      "Передать диалог продавцу. После этого бот молчит, пока продавец не ответит. summary_ru — суть для продавца по-русски, до 300 знаков: что хочет покупатель и что уже сказано.",
    input_schema: obj(
      {
        kind: { type: "string", enum: [...HANDOFF_KINDS] },
        summary_ru: { type: "string" },
      },
      ["kind", "summary_ru"],
    ),
  },
  {
    name: "remember_fact",
    description:
      "Запомнить о покупателе: name, grade (класс), subject (предмет), for_whom (для кого), looking_for (что ищет), language (ru/kk/en/uz), notes. Без телефонов, адресов, карт и сумм.",
    input_schema: obj(
      {
        key: { type: "string", enum: FACT_KEYS.filter((k) => k !== "country") },
        value: { type: "string" },
      },
      ["key", "value"],
    ),
  },
  {
    name: "set_country",
    description:
      "Покупатель назвал страну: код ISO из двух букв (KZ, RU, UZ, KG…). От страны зависят валюта и способы оплаты.",
    input_schema: obj({ country: { type: "string" } }, ["country"]),
  },
  {
    name: "search_knowledge",
    description:
      "Найти среди ответов продавца на прошлые вопросы — когда в промпте показаны не все.",
    input_schema: obj({ query: { type: "string" } }, ["query"]),
  },
];

export function formatMoney(minor: number, currency: string): string {
  const units = minor / 100;
  const s = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: Number.isInteger(units) ? 0 : 2,
  })
    .format(units)
    .replace(/\s/gu, " ");
  return `${s} ${currency}`;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(v);
const nowArg = (a: TurnArgs) => (a.now ? { now: a.now } : {});

/** Что роль знает о покупателе на этот ход (из seller_context_v2). */
export type SellerTurn = { country: string | null; lang: BuyerLang };

function money(s: RoleSession, minor: number, currency: string) {
  s.allowedNumbers.push(minor / 100);
  return formatMoney(minor, currency);
}

async function price(db: V4Db, s: RoleSession, a: TurnArgs, t: SellerTurn, productId: string) {
  const [q] = await db.call("quote", {
    p_bot_id: a.botId,
    p_product_ids: [productId],
    p_country: t.country,
  });
  return q ? money(s, Number(q.total_minor), String(q.currency)) : null;
}

export function offerLabel(lang: BuyerLang, titles: string[], total: string): string {
  return titles.length === 1
    ? `${TEXTS.buy[lang]}: ${titles[0]} · ${total}`
    : `${TEXTS.buyAll[lang]} (${titles.length}) · ${total}`;
}

export async function runSellerTool(
  db: V4Db,
  s: RoleSession,
  a: TurnArgs,
  t: SellerTurn,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "find_products": {
      const rows = await db.call("find_products", {
        p_bot_id: a.botId,
        p_query: str(input.query),
        p_limit: 8,
      });
      const items = [];
      for (const r of rows) {
        const title = String(r.title) + (r.variant_label ? ` · ${String(r.variant_label)}` : "");
        s.quoted.push(String(r.title), title);
        items.push({
          product_id: String(r.product_id),
          title,
          has_variants: Boolean(r.has_variants),
          price: r.has_variants ? null : await price(db, s, a, t, String(r.product_id)),
        });
      }
      return { items, note: items.length ? undefined : "Ничего не нашлось по этим словам." };
    }
    case "product_card": {
      const id = str(input.product_id);
      if (!isUuid(id))
        return { ok: false, error: "Нет такого товара — найди через find_products." };
      const c = (
        await db.call("product_details", {
          p_bot_id: a.botId,
          p_product_id: id,
          p_country: t.country,
        })
      )[0]?.product_details as Record<string, unknown> | null | undefined;
      if (!c) return { ok: false, error: "Товар не продаётся." };
      const p = c.price as { currency: string; amount_minor: number } | null;
      const variants = (c.variants as Array<Record<string, unknown>>).map((v) => {
        s.quoted.push(String(v.label));
        return {
          product_id: String(v.product_id),
          label: String(v.label),
          price: money(s, Number(v.amount_minor), String(v.currency)),
        };
      });
      const pairs = (c.pairs_with as Array<{ product_id: string; title: string }>).map((x) => {
        s.quoted.push(x.title);
        return x;
      });
      s.quoted.push(String(c.title));
      const description = (c.description as string | null) ?? null;
      if (description) s.allowedNumbers.push(...numbersIn(description));
      return {
        title: c.title,
        description,
        price: variants.length || !p ? null : money(s, Number(p.amount_minor), p.currency),
        variants,
        pairs_with: pairs,
        has_photos: Boolean(c.has_photos),
      };
    }
    case "show_offer": {
      const ids = [
        ...new Set((Array.isArray(input.product_ids) ? input.product_ids : []).map(str)),
      ].filter(Boolean);
      if (!ids.length || ids.some((id) => !isUuid(id)))
        return { ok: false, error: "Нужны id товаров из find_products." };
      if (s.buttons.length >= MAX_OFFERS_PER_REPLY)
        return { ok: false, error: `Не больше ${MAX_OFFERS_PER_REPLY} кнопок в ответе.` };
      const r = await createOffer(db, {
        botId: a.botId,
        buyerId: a.buyerId,
        productIds: ids,
        mode: a.mode,
        ...nowArg(a),
      });
      if (!r.ok) {
        const why = {
          choose_variant: "У товара есть варианты — спроси, какой нужен, и предложи вариант.",
          product_unavailable: "Товар не продаётся — найди через find_products.",
          empty_order: "Нужен хотя бы один товар.",
          too_many: "Не больше 10 товаров в одном предложении.",
        }[r.reason];
        return { ok: false, error: why };
      }
      const o = r.offer;
      const total = money(s, o.totalMinor, o.currency);
      for (const i of o.items) {
        s.quoted.push(i.title);
        s.allowedNumbers.push(i.amountMinor / 100);
      }
      const label = offerLabel(
        t.lang,
        o.items.map((i) => i.title),
        total,
      );
      // Те же товары по той же цене дважды в одном ответе — одна кнопка.
      if (s.buttons.some((b) => b.label === label))
        return { ok: true, already_shown: true, note: "Эта кнопка уже под ответом." };
      s.buttons.push({ offerId: o.offerId, label });
      return {
        ok: true,
        total,
        items: o.items.map((i) => ({
          title: i.title,
          price: formatMoney(i.amountMinor, o.currency),
        })),
        note: "Кнопка будет под ответом. Не заканчивай ответ вопросом.",
      };
    }
    case "payment_methods": {
      const methods = await methodsFor(db, a.botId, t.country);
      s.allowedContacts.push(...methods.map((m) => m.details).filter(Boolean));
      return {
        methods: methods.map((m) => ({
          kind: m.kind,
          currency: m.currency,
          how:
            m.kind === "transfer"
              ? "перевод по реквизитам после нажатия «Купить», потом прислать чек"
              : "оплата по ссылке после нажатия «Купить», доступ сразу после оплаты",
        })),
        note: methods.length
          ? undefined
          : "Для этой страны способов оплаты нет — cant_pay или продавцу.",
      };
    }
    case "order_status": {
      const rows = await db.call("buyer_open_orders", { p_bot_id: a.botId, p_buyer_id: a.buyerId });
      return {
        orders: rows.map((r) => {
          s.allowedNumbers.push(Number(r.no));
          return {
            no: Number(r.no),
            total: money(s, Number(r.total_minor), String(r.currency)),
            paid: money(s, Number(r.paid_minor), String(r.currency)),
            state: String(r.money_state),
            receipt_waiting: Boolean(r.unconfirmed),
          };
        }),
      };
    }
    case "cancel_order": {
      const no = Number(input.order_no);
      if (!Number.isInteger(no) || no <= 0) return { ok: false, error: "Нужен номер заказа." };
      const r = (
        await db.call("cancel_by_buyer", {
          p_bot_id: a.botId,
          p_buyer_id: a.buyerId,
          p_order_no: no,
        })
      )[0]?.cancel_by_buyer as string | undefined;
      s.allowedNumbers.push(no);
      if (r === "ok") {
        s.actions.push({ kind: "order_cancelled", orderNo: no });
        return { ok: true };
      }
      const why: Record<string, string> = {
        not_yours: "У покупателя нет заказа с таким номером.",
        not_open: "Заказ уже закрыт.",
        paid: "По заказу есть оплата — отменить может только продавец (hand_to_seller).",
        receipt_waiting: "Чек на проверке — отменить может только продавец (hand_to_seller).",
      };
      return { ok: false, error: why[r ?? ""] ?? "Не получилось." };
    }
    case "cabinet_link": {
      if (s.actions.some((x) => x.kind === "cabinet_link")) return { ok: true };
      const link = await issueCabinetLink(db, a.botId, a.buyerId);
      s.actions.push({
        kind: "cabinet_link",
        token: link.token,
        expiresAt: link.expiresAt.toISOString(),
      });
      return { ok: true, note: "Кнопка кабинета будет под ответом. Ссылку не пиши." };
    }
    case "cant_pay": {
      const r = await cantPay(db, {
        botId: a.botId,
        buyerId: a.buyerId,
        reason: str(input.reason).slice(0, HANDOFF_SUMMARY_MAX) || "не указана",
        by: "bot",
      });
      if (!r.ok) return { ok: false, error: r.code };
      s.actions.push({ kind: "cant_pay", caseId: r.value.caseId });
      return { ok: true, note: "Продавец получил дело и свяжется с покупателем." };
    }
    case "hand_to_seller": {
      if (s.handedOff) return { ok: true };
      const kind = (HANDOFF_KINDS as readonly string[]).includes(str(input.kind))
        ? str(input.kind)
        : "other";
      const summary =
        str(input.summary_ru).slice(0, HANDOFF_SUMMARY_MAX) || "покупатель просит продавца";
      const caseId = await handToSeller(db, {
        botId: a.botId,
        buyerId: a.buyerId,
        reason: `${HANDOFF_LABEL[kind as HandoffKind]}: ${summary}`,
        by: "bot",
      });
      s.handedOff = true;
      s.buttons = [];
      s.actions.push({ kind: "handoff", caseId, reason: kind });
      return {
        ok: true,
        note: "Диалог у продавца. Коротко скажи, что продавец ответит, без кнопок.",
      };
    }
    case "remember_fact": {
      const key = str(input.key);
      if (key === "country") return { ok: false, error: "Страну — через set_country." };
      const r = await rememberFact(db, {
        botId: a.botId,
        buyerId: a.buyerId,
        key,
        value: str(input.value),
        source: "bot",
        ...nowArg(a),
      });
      if (r === "ok") s.actions.push({ kind: "remembered", key });
      return r === "ok" ? { ok: true } : { ok: false, error: r };
    }
    case "set_country": {
      const country = str(input.country).toUpperCase();
      const r = await rememberFact(db, {
        botId: a.botId,
        buyerId: a.buyerId,
        key: "country",
        value: country,
        source: "buyer",
        ...nowArg(a),
      });
      if (r !== "ok") return { ok: false, error: "Неизвестный код страны." };
      t.country = country;
      s.actions.push({ kind: "remembered", key: "country" });
      return {
        ok: true,
        note: "Цены теперь для этой страны — найди товар заново, если цену уже называл.",
      };
    }
    case "search_knowledge": {
      const c = (
        await db.call("seller_context_v2", {
          p_bot_id: a.botId,
          p_buyer_id: a.buyerId,
          p_query: str(input.query),
        })
      )[0]?.seller_context_v2 as { knowledge: Array<{ question: string; answer: string }> } | null;
      const found = c?.knowledge ?? [];
      for (const k of found) s.allowedNumbers.push(...numbersIn(k.answer));
      return { items: found };
    }
    default:
      return { ok: false, error: `Нет инструмента ${name}` };
  }
}

type HandoffKind = (typeof HANDOFF_KINDS)[number];
const HANDOFF_LABEL: Record<HandoffKind, string> = {
  human: "Просит продавца",
  question: "Вопрос без ответа",
  complaint: "Жалоба",
  payment: "Оплата",
  custom: "Особый заказ",
  other: "Другое",
};

/** Числа из текста магазина (описания, знания): их бот может повторить. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d(?:[\d\u00a0\u202f ]*\d)?(?:[.,]\d+)?/gu)) {
    let c = m[0].replace(/[\u00a0\u202f ]/gu, "");
    if (/^\d{1,3}([.,]\d{3})+$/u.test(c)) c = c.replace(/[.,]/gu, "");
    else c = c.replace(",", ".");
    const n = Number(c);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export { asLang };
