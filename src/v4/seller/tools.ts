import type Anthropic from "@anthropic-ai/sdk";
import type { V4Db } from "../core/db";
import { cantPay, handToSeller } from "../core/cases/cases";
import { methodsFor } from "../core/money/money";
import { issueCabinetLink } from "../core/access/access";

/**
 * Инструменты ИИ-продавца v4. Заказ модель сама не создаёт: она показывает
 * карточку с кнопкой «Купить» (решение 8), заказ создаёт нажатие кнопки
 * (`buyNow`) — без «Оформляем заказ?» и без лишнего круга переписки.
 */

export type ReplyButton = { kind: "buy"; productId: string; title: string };

/** Что ответ делает, кроме текста. Адаптер канала рисует это по-своему. */
export type ReplyAction =
  | { kind: "handoff"; caseId: string }
  | { kind: "cant_pay"; caseId: string }
  | { kind: "cabinet_link"; token: string; expiresAt: Date };

export type ToolRun = {
  db: V4Db;
  botId: string;
  buyerId: string;
  country: string | null;
  buttons: ReplyButton[];
  actions: ReplyAction[];
};

export const SELLER_TOOLS: Anthropic.Tool[] = [
  {
    name: "find_products",
    description:
      "Найти товары магазина по словам покупателя. Возвращает id, название, вариант и цену для страны покупателя. Если у товара есть варианты (has_variants), спроси, какой нужен, и ищи вариант.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Слова из сообщения покупателя" } },
      required: ["query"],
    },
  },
  {
    name: "offer_card",
    description:
      "Показать покупателю кнопку «Купить» под твоим ответом. Зови, как только понятно, какой товар нужен: кнопка заменяет вопрос «Оформляем заказ?». Не больше 3 товаров.",
    input_schema: {
      type: "object",
      properties: { product_id: { type: "string" } },
      required: ["product_id"],
    },
  },
  {
    name: "payment_methods",
    description:
      "Чем покупатель из своей страны может заплатить. Скажи способы оплаты до того, как покупатель нажмёт «Купить».",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "order_status",
    description: "Открытые заказы покупателя: номер, сумма, сколько оплачено.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cabinet_link",
    description:
      "Покупатель потерял файл или ссылку на купленное: приложить к ответу ссылку на его кабинет. Ссылку не пиши сам — её добавит система.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cant_pay",
    description:
      "Покупатель хочет купить, но не может заплатить ни одним способом. Продавец получит дело с причиной.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
  {
    name: "hand_to_seller",
    description:
      "Передать диалог продавцу: покупатель просит человека, или ответа нет ни в анкете, ни в знаниях. После этого бот молчит, пока продавец не ответит.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "Вопрос покупателя для продавца" } },
      required: ["reason"],
    },
  },
];

const MAX_BUTTONS = 3;

export function formatMoney(minor: number, currency: string): string {
  const units = minor / 100;
  const s = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: Number.isInteger(units) ? 0 : 2,
  })
    .format(units)
    .replace(/\s/gu, " ");
  return `${s} ${currency}`;
}

async function priceFor(run: ToolRun, productId: string) {
  const [q] = await run.db.call("quote", {
    p_bot_id: run.botId,
    p_product_ids: [productId],
    p_country: run.country,
  });
  return q ? formatMoney(Number(q.total_minor), String(q.currency)) : null;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Выполнить вызов инструмента. Ответ — JSON для модели; ошибки ввода — тоже ответ, не исключение. */
export async function runTool(
  run: ToolRun,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "find_products": {
      const rows = await run.db.call("find_products", {
        p_bot_id: run.botId,
        p_query: str(input.query),
        p_limit: 8,
      });
      const items = [];
      for (const r of rows) {
        items.push({
          product_id: String(r.product_id),
          title: String(r.title),
          variant: (r.variant_label as string | null) ?? null,
          has_variants: Boolean(r.has_variants),
          price: r.has_variants ? null : await priceFor(run, String(r.product_id)),
        });
      }
      return { items };
    }
    case "offer_card": {
      const id = str(input.product_id);
      const found = await productById(run, id);
      if (!found) return { ok: false, error: "Нет такого товара. Найди его через find_products." };
      if (found.has_variants)
        return {
          ok: false,
          error: "У товара есть варианты: спроси, какой нужен, и покажи вариант.",
        };
      if (run.buttons.some((b) => b.productId === id)) return { ok: true };
      if (run.buttons.length >= MAX_BUTTONS) return { ok: false, error: "Уже 3 кнопки." };
      run.buttons.push({ kind: "buy", productId: id, title: found.title });
      return { ok: true, price: await priceFor(run, id) };
    }
    case "payment_methods": {
      const methods = await methodsFor(run.db, run.botId, run.country);
      return {
        methods: methods.map((m) => ({
          kind: m.kind,
          currency: m.currency,
          how:
            m.kind === "transfer"
              ? "перевод по реквизитам после нажатия «Купить», потом прислать чек"
              : "оплата картой по ссылке после нажатия «Купить», доступ сразу",
        })),
      };
    }
    case "order_status": {
      const rows = await run.db.call("buyer_open_orders", {
        p_bot_id: run.botId,
        p_buyer_id: run.buyerId,
      });
      return {
        orders: rows.map((r) => ({
          no: Number(r.no),
          total: formatMoney(Number(r.total_minor), String(r.currency)),
          paid: formatMoney(Number(r.paid_minor), String(r.currency)),
          state: String(r.money_state),
          receipt_waiting: Boolean(r.unconfirmed),
        })),
      };
    }
    case "cabinet_link": {
      if (run.actions.some((a) => a.kind === "cabinet_link")) return { ok: true };
      const link = await issueCabinetLink(run.db, run.botId, run.buyerId);
      run.actions.push({ kind: "cabinet_link", ...link });
      return { ok: true, note: "Ссылка будет приложена к ответу кнопкой." };
    }
    case "cant_pay": {
      const r = await cantPay(run.db, {
        botId: run.botId,
        buyerId: run.buyerId,
        reason: str(input.reason) || "не указана",
        by: "bot",
      });
      if (!r.ok) return { ok: false, error: r.code };
      run.actions.push({ kind: "cant_pay", caseId: r.value.caseId });
      return { ok: true, note: "Продавец получил дело и свяжется с покупателем." };
    }
    case "hand_to_seller": {
      const caseId = await handToSeller(run.db, {
        botId: run.botId,
        buyerId: run.buyerId,
        reason: str(input.reason) || "покупатель просит продавца",
        by: "bot",
      });
      run.actions.push({ kind: "handoff", caseId });
      return { ok: true, note: "Диалог у продавца. Скажи покупателю, что продавец ответит." };
    }
    default:
      return { ok: false, error: `Нет инструмента ${name}` };
  }
}

async function productById(run: ToolRun, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await run.db.call("product_card", { p_bot_id: run.botId, p_product_id: id });
  const r = rows[0];
  return r ? { title: String(r.title), has_variants: Boolean(r.has_variants) } : null;
}
