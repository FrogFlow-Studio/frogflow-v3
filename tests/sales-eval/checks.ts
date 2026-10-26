/**
 * Набор продаж консультанта в переписке (WhatsApp, магазин в чате): что
 * проверяем в каждом ходе живого прогона. Это измерение, а не фильтр в проде:
 * здесь можно смотреть на знаки и слова, цель — посчитать, а не исправить
 * (как в pricelist/eval/checks).
 *
 * Мерило — то, на чём терялись покупатели Копилки 21–25.10: ответ без кнопки
 * и с вопросом «Оформляем заказ?» (18 из 25 замолчали), простыня текста,
 * заготовка кода вместо ответа («Уточните, пожалуйста…» четыре раза подряд
 * покупательнице, которая уже платила), передача менеджеру там, где ответ есть
 * в карточке товара.
 */
import { isBuyButtonTitle } from "@/channels/zernio/shop/buy-button";
import { clarifyReply, priceUnsureReply, unavailableReply } from "@/core/consultant/messages";
import type { Locale } from "@/core/i18n/locale";

/** Что покупатель должен получить к концу хода. */
export type BuyExpect =
  /** Кнопка «Купить» или уже оформленный заказ. */
  | "offer"
  /** Заказ оформлен в этом ходе. */
  | "order"
  /** Ни кнопки, ни заказа (приветствие, вопрос не о товаре). */
  | "none"
  | "any";

export type SalesTurnExpect = {
  buy?: BuyExpect;
  /** Передача менеджеру допустима (жалоба, просьба человека). По умолчанию — нет. */
  handoff?: boolean;
  /** Ответ на казахском. */
  kazakh?: boolean;
  /** Предел длины всех ответов хода в знаках. По умолчанию 600. */
  maxChars?: number;
  /** Ответ не заканчивается вопросом (там, где покупатель уже выбрал). */
  noQuestionEnd?: boolean;
  /** Факт из карточки, который должен прозвучать (А4, состав). */
  must?: RegExp[];
};

export type SalesTurn =
  | { text: string; expect?: SalesTurnExpect }
  /** Нажатие кнопки, заголовок которой — «Купить»: её нет — ход провален. */
  | { click: "buy"; expect?: SalesTurnExpect };

export type SalesScenario = {
  id: string;
  title: string;
  /** Откуда: живой диалог (клиент, канал, дата). */
  origin: string;
  locale: Locale;
  turns: SalesTurn[];
  /** К концу диалога у покупателя есть кнопка или заказ. */
  reachOffer?: boolean;
};

/** Что произошло в ходе: ответы бота, кнопки, заказы, передача. */
export type TurnOutcome = {
  replies: string[];
  buttons: string[];
  newOrders: number;
  handedOff: boolean;
};

export type Flag =
  | "no_offer"
  | "no_order"
  | "unexpected_offer"
  | "handoff"
  | "canned"
  | "too_long"
  | "question_end"
  | "not_kazakh"
  | "missing_fact"
  | "no_buy_button"
  | "silent";

const PENDING_ORDER_RU = "Пока заказ не оформлен. Что именно вы хотели узнать о товаре?";
const LOCALES: Locale[] = ["ru", "kk", "en", "uz"];

/** Заготовки кода вместо ответа модели: на любом языке. */
export function isCanned(reply: string): boolean {
  const t = reply.trim();
  if (t === PENDING_ORDER_RU) return true;
  return LOCALES.some(
    (l) => t === clarifyReply(l) || t === unavailableReply(l) || t === priceUnsureReply(l),
  );
}

/** Казахские буквы, которых нет в русском. */
const KAZAKH_LETTERS = /[әғқңөұүһі]/iu;

export function hasBuyOffer(o: TurnOutcome): boolean {
  return o.newOrders > 0 || o.buttons.some((b) => isBuyButtonTitle(b));
}

export function checkTurn(o: TurnOutcome, e: SalesTurnExpect = {}): Flag[] {
  const flags: Flag[] = [];
  const text = o.replies.join("\n").trim();
  if (!text && !o.buttons.length) flags.push("silent");
  const offered = hasBuyOffer(o);
  const buy = e.buy ?? "any";
  if (buy === "offer" && !offered) flags.push("no_offer");
  if (buy === "order" && o.newOrders === 0) flags.push("no_order");
  if (buy === "none" && offered) flags.push("unexpected_offer");
  if (o.handedOff && !e.handoff) flags.push("handoff");
  if (o.replies.some(isCanned)) flags.push("canned");
  if (text.length > (e.maxChars ?? 600)) flags.push("too_long");
  // Последняя строка последнего ответа: «…Оформляем заказ?» под ценой.
  if (e.noQuestionEnd && /\?\s*$/u.test(text)) flags.push("question_end");
  if (e.kazakh && !KAZAKH_LETTERS.test(text)) flags.push("not_kazakh");
  if (e.must?.some((re) => !re.test(text))) flags.push("missing_fact");
  return flags;
}

export type TurnResult = {
  say: string;
  replies: string[];
  buttons: string[];
  flags: Flag[];
};

export type ScenarioResult = {
  id: string;
  title: string;
  turns: TurnResult[];
  /** Дошёл ли покупатель до кнопки или заказа хоть раз. */
  offered: boolean;
  ordered: boolean;
  pass: boolean;
  flags: Flag[];
};

export function scenarioResult(
  s: SalesScenario,
  turns: Array<TurnResult & { outcome: TurnOutcome }>,
): ScenarioResult {
  const offered = turns.some((t) => hasBuyOffer(t.outcome));
  const ordered = turns.some((t) => t.outcome.newOrders > 0);
  const flags = turns.flatMap((t) => t.flags);
  if (s.reachOffer && !offered) flags.push("no_offer");
  return {
    id: s.id,
    title: s.title,
    turns: turns.map(({ outcome: _o, ...t }) => t),
    offered,
    ordered,
    pass: flags.length === 0,
    flags: [...new Set(flags)],
  };
}

/** Сводка прогона: доли сценариев и ходов, что чаще всего ломается. */
export function salesSummary(results: ScenarioResult[]) {
  const turns = results.flatMap((r) => r.turns);
  const count = (f: Flag) => turns.filter((t) => t.flags.includes(f)).length;
  const first = results
    .map((r) => r.turns[0]?.replies.join("\n").length ?? 0)
    .sort((a, b) => a - b);
  const median = first.length ? first[Math.floor((first.length - 1) / 2)]! : 0;
  return {
    scenarios: results.length,
    passed: results.filter((r) => r.pass).length,
    offered: results.filter((r) => r.offered).length,
    ordered: results.filter((r) => r.ordered).length,
    turns: turns.length,
    firstReplyMedianChars: median,
    flags: Object.fromEntries(
      (
        [
          "no_offer",
          "no_order",
          "unexpected_offer",
          "handoff",
          "canned",
          "too_long",
          "question_end",
          "not_kazakh",
          "missing_fact",
          "no_buy_button",
          "silent",
        ] as Flag[]
      )
        .map((f) => [f, count(f)] as const)
        .filter(([, n]) => n > 0),
    ),
  };
}

const FLAG_TEXT: Record<Flag, string> = {
  no_offer: "нет кнопки «Купить» и нет заказа",
  no_order: "заказ не оформлен",
  unexpected_offer: "кнопка или заказ там, где покупатель не выбирал",
  handoff: "передано менеджеру",
  canned: "заготовка кода вместо ответа",
  too_long: "слишком длинно",
  question_end: "ответ кончается вопросом",
  not_kazakh: "ответ не на казахском",
  missing_fact: "нет факта из карточки",
  no_buy_button: "нажимать нечего: кнопки «Купить» нет",
  silent: "бот промолчал",
};

export function salesReport(
  results: ScenarioResult[],
  meta: { model: string; usd: number; snapshot: string },
): string {
  const s = salesSummary(results);
  const lines = [
    `# Набор продаж консультанта: ${meta.model}`,
    "",
    `Магазин: ${meta.snapshot}. Расход: ${meta.usd.toFixed(3)} $.`,
    "",
    `- Сценариев без замечаний: ${s.passed} из ${s.scenarios}`,
    `- Дошли до кнопки или заказа: ${s.offered} из ${s.scenarios}`,
    `- Заказ оформлен: ${s.ordered} из ${s.scenarios}`,
    `- Первый ответ, медиана: ${s.firstReplyMedianChars} знаков`,
    ...Object.entries(s.flags).map(([f, n]) => `- ${FLAG_TEXT[f as Flag]}: ${n} ход.`),
    "",
  ];
  for (const r of results) {
    lines.push(`## ${r.pass ? "✅" : "❌"} ${r.id}: ${r.title}`, "");
    for (const t of r.turns) {
      lines.push(`> ${t.say}`);
      for (const reply of t.replies) lines.push(reply.replace(/^/gmu, "    "));
      if (t.buttons.length) lines.push(`    [${t.buttons.join("] [")}]`);
      if (t.flags.length) lines.push(`    ⚠ ${t.flags.map((f) => FLAG_TEXT[f]).join("; ")}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
