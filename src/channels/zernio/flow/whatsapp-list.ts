import type { Json } from "@/core/db-types";
import { toJson } from "@/core/json";

/** Списки WhatsApp. */

/* ── WhatsApp: списки вместо нумерованного текста ─────────────────────
 * У Instagram три кнопки на сообщение, у WhatsApp — список до десяти строк:
 * категории, товары, страны и языки покупатель выбирает нажатием. Ответ
 * приходит `interactiveId` строки, и в нём — тот же postback, что у кнопки
 * (`CAT:`, `PROD:`), либо `STEP:<номер>` — ответ на текущий шаг сценария,
 * который разбирается как набранная цифра.
 */
export const STEP_PREFIX = "STEP:";

export const WA_LIST_MAX_ROWS = 10;

/** Строк под содержимое: остальное — «ещё», «корзина», «назад». */
export const WA_LIST_PAGE = WA_LIST_MAX_ROWS - 3;

const WA_ROW_TITLE_MAX = 24;

const WA_ROW_DESCRIPTION_MAX = 72;

export type WhatsAppListRow = { id: string; title: string; description?: string };

export type WhatsAppListSection = { title: string; rows: WhatsAppListRow[] };

/** Ответ строкой списка на шаг сценария — номер, как если бы его набрали текстом. */
export function stepAnswer(payload: string | null | undefined): string | null {
  if (!payload || !payload.startsWith(STEP_PREFIX)) return null;
  const v = payload.slice(STEP_PREFIX.length).trim();
  return v || null;
}

/** Обрезать заголовок строки: Meta режет перебор молча, лучше с многоточием. */
export function clipRowTitle(title: string, max = WA_ROW_TITLE_MAX): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Вторая строка товара в списке WhatsApp. Название длиннее заголовка строки
 * продолжается здесь — иначе «034. Декор на дверь к 1…» и «035. Декор на
 * дверь к 1…» неразличимы. Цена идёт после хвоста, если влезает; не влезает
 * вместе — хвост важнее: цену покупатель увидит в карточке, а чем товары
 * отличаются — уже нет (как rowSubtitle в v1).
 */
export function rowSubtitle(name: string, price: string): string {
  const t = name.replace(/\s+/g, " ").trim();
  // Заголовок показывает первые WA_ROW_TITLE_MAX − 1 символов и «…» (clipRowTitle).
  const tail = t.length > WA_ROW_TITLE_MAX ? t.slice(WA_ROW_TITLE_MAX - 1).trim() : "";
  if (!tail) return price;
  const withPrice = `${tail} · ${price}`;
  if (withPrice.length <= WA_ROW_DESCRIPTION_MAX) return withPrice;
  return tail;
}

/** Родной interactive-объект Meta типа list; общий лимит строк — на всё сообщение. */
export function whatsappList(params: {
  body: string;
  buttonLabel: string;
  sections: WhatsAppListSection[];
  header?: string;
}): Json {
  let budget = WA_LIST_MAX_ROWS;
  const sections: WhatsAppListSection[] = [];
  for (const section of params.sections) {
    if (budget <= 0) break;
    const rows = section.rows.slice(0, budget).map((row) => ({
      id: row.id.slice(0, 200),
      title: clipRowTitle(row.title),
      ...(row.description
        ? { description: clipRowTitle(row.description, WA_ROW_DESCRIPTION_MAX) }
        : {}),
    }));
    if (rows.length === 0) continue;
    budget -= rows.length;
    sections.push({ title: clipRowTitle(section.title), rows });
  }
  return toJson({
    type: "list",
    ...(params.header ? { header: { type: "text", text: params.header.slice(0, 60) } } : {}),
    body: { text: params.body.slice(0, 1024) },
    action: { button: params.buttonLabel.slice(0, 20), sections },
  });
}
