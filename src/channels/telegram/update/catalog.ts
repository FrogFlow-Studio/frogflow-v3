// Каталог: категории, карточка товара, поиск и подбор (квиз).
import {
  categoryParentId,
  listChildCategories,
  listProductsInCategory,
  type Product,
  PRODUCT_SELECT,
  searchProductsTolerant,
} from "@/core/catalog/catalog";
import { sendPhotoOrText } from "../api";
import { productCard } from "../screens";
import type { InlineButton } from "../types";
import { categoryButtonLabel, escapeHtml } from "../copy";
import { setState } from "@/core/customers/customers";
import { searchPage } from "../legacy";
import { serverFailure } from "@/lib/server-failure";
import { type Bot, PAGE, send } from "./bot";

// ── каталог ───────────────────────────────────────────────────────────

async function backButton(b: Bot, parentId: string | null): Promise<InlineButton[] | null> {
  if (!parentId) return null;
  const up = await categoryParentId(b.ctx, parentId);
  return [{ text: b.m.back, callback_data: up ? `cat:${up}:0` : "cat:root:0" }];
}

export async function showCategories(b: Bot, parentId: string | null, offset: number) {
  const [cats, products] = await Promise.all([
    listChildCategories(b.ctx, parentId),
    listProductsInCategory(b.ctx, parentId),
  ]);
  if (offset === 0 && cats.length > 0) {
    const rows: InlineButton[][] = cats.map((c) => [
      { text: categoryButtonLabel(c.name), callback_data: `cat:${c.id}:0` },
    ]);
    const back = await backButton(b, parentId);
    if (back) rows.push(back);
    await send(b, parentId ? b.m.subcategories : b.m.catalogHeader, {
      reply_markup: { inline_keyboard: rows },
    });
  }
  if (products.length === 0 && cats.length === 0) {
    if (offset === 0) {
      const back = await backButton(b, parentId);
      await send(b, b.m.emptyHere, back ? { reply_markup: { inline_keyboard: [back] } } : {});
    }
    return;
  }
  for (const p of products.slice(offset, offset + PAGE)) await sendProductCard(b, p);
  const nav: InlineButton[][] = [];
  if (offset + PAGE < products.length) {
    nav.push([{ text: b.m.showMore, callback_data: `cat:${parentId ?? "root"}:${offset + PAGE}` }]);
  }
  if (parentId && (cats.length === 0 || offset > 0)) {
    const back = await backButton(b, parentId);
    if (back) nav.push([{ ...back[0]!, text: b.m.backToCategories }]);
  }
  if (nav.length) await send(b, b.m.navigation, { reply_markup: { inline_keyboard: nav } });
}

/** Квиз: вопрос номер q; ответы копятся в state.quiz_tags до результата. */
export async function quizAsk(b: Bot, q: number, fresh = false): Promise<void> {
  const { loadQuiz } = await import("@/core/quiz/quiz");
  const quiz = await loadQuiz(b.ctx);
  if (!quiz.questions.length) {
    await send(b, b.m.quizNotReady, {
      reply_markup: { inline_keyboard: [[{ text: b.m.catalog, callback_data: "cat:root" }]] },
    });
    return;
  }
  if (fresh) {
    b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, quiz_tags: [] });
    if (quiz.intro) await send(b, escapeHtml(quiz.intro));
  }
  const question = quiz.questions[q];
  if (!question) return quizFinish(b);
  await send(b, `<b>${q + 1}/${quiz.questions.length}.</b> ${escapeHtml(question.text)}`, {
    reply_markup: {
      inline_keyboard: question.options.map((o, i) => [
        { text: o.label, callback_data: `quiz:${q}:${i}` },
      ]),
    },
  });
}

async function quizFinish(b: Bot): Promise<void> {
  const { quizResult } = await import("@/core/quiz/quiz");
  const tags = Array.isArray(b.customer.state.quiz_tags)
    ? (b.customer.state.quiz_tags as string[])
    : [];
  const found = await quizResult(b.ctx, tags);
  // Итог подбора для карточки на «Рассылках»: прошли до конца, что бы ни нашлось.
  const { recordEngage } = await import("@/core/automsg/engage");
  await recordEngage(b.ctx, "quiz_done", b.customer.telegramId);
  if (!found.length) {
    await send(b, b.m.quizNothing, {
      reply_markup: { inline_keyboard: [[{ text: b.m.catalog, callback_data: "cat:root" }]] },
    });
    return;
  }
  await send(b, b.m.quizResult, {
    reply_markup: {
      inline_keyboard: found.map((p) => [
        { text: p.name.slice(0, 60), callback_data: `prod:${p.id}` },
      ]),
    },
  });
}

export async function sendProductCard(b: Bot, p: Product) {
  const {
    caption,
    keyboard: base,
    photo,
  } = await productCard(b.ctx, p, b.locale, b.customer.state.country_code ?? null);
  // Пример цифрового товара (core/catalog/preview) — кнопкой под карточкой.
  const { loadPreview } = await import("@/core/catalog/preview");
  const hasPreview =
    p.fulfillment_kind !== "physical" && (await loadPreview(b.ctx, p.id)).length > 0;
  const keyboard = hasPreview
    ? {
        ...base,
        inline_keyboard: [
          ...(base.inline_keyboard ?? []),
          [{ text: b.m.previewBtn, callback_data: `prev:${p.id}` }],
        ],
      }
    : base;
  if (!photo) {
    await send(b, caption, { reply_markup: keyboard });
  } else {
    await sendPhotoOrText(
      b.api,
      {
        chat_id: b.chatId,
        photo,
        caption: caption.slice(0, 1024),
        parse_mode: "HTML",
        reply_markup: keyboard,
      },
      () => send(b, caption, { reply_markup: keyboard }),
    );
  }
}

/**
 * Поиск по каталогу страницами по PAGE. Запрос запоминается в
 * state.last_search: в callback `searchmore:<сдвиг>` он не помещается
 * (64 байта), формат общий с v1 — её кнопки в старых чатах тоже работают.
 */
export async function showSearch(b: Bot, query: string, offset = 0) {
  const found = await searchProductsTolerant(b.ctx, query);
  if (b.customer.state.last_search !== query)
    b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, last_search: query });
  if (found.length > 0) {
    const page = searchPage(found.length, offset, PAGE);
    if (page.from === 0) await send(b, b.m.searchResults(escapeHtml(query), found.length));
    for (const p of found.slice(page.from, page.to)) await sendProductCard(b, p);
    if (page.next !== null)
      await send(b, b.m.searchShown(page.to, found.length), {
        reply_markup: {
          inline_keyboard: [[{ text: b.m.showMore, callback_data: `searchmore:${page.next}` }]],
        },
      });
    return;
  }
  // Следующая страница без результатов (каталог изменился) — не звать LLM повторно.
  if (offset > 0) {
    await send(b, b.m.searchNothing(escapeHtml(query)));
    return;
  }
  const smart = await smartSearchFallback(b, query);
  if (smart.length === 0) {
    await send(b, b.m.searchNothing(escapeHtml(query)));
    return;
  }
  await send(b, b.m.smartSearchResults(escapeHtml(query), smart.length));
  for (const p of smart.slice(0, PAGE)) await sendProductCard(b, p);
}

/** Сколько результатов свободного поиска показываем кнопками. */
export const FREE_SEARCH_MAX = 8;

/** Свободный текст — запрос поиска: не команда, не пустой, не длиннее поиска каталога. */
export function isFreeTextQuery(text: string): boolean {
  const t = text.trim();
  return t.length >= 2 && t.length <= 80 && !t.startsWith("/");
}

/**
 * Любой текст вне шага — поиск по названию, ключевым словам и описанию (с
 * опечаткой в одну букву): до FREE_SEARCH_MAX товаров кнопками, иначе «не нашёл»
 * с кнопкой «Каталог». Запрос запоминается для «Показать ещё» (searchmore).
 */
export async function freeTextSearch(b: Bot, text: string) {
  const query = text.trim();
  const found = await searchProductsTolerant(b.ctx, query, FREE_SEARCH_MAX + 1);
  if (found.length === 0) {
    await send(b, b.m.searchNothing(escapeHtml(query)), {
      reply_markup: { inline_keyboard: [[{ text: b.m.catalog, callback_data: "cat:root" }]] },
    });
    return;
  }
  if (b.customer.state.last_search !== query)
    b.customer = await setState(b.ctx, b.customer, { ...b.customer.state, last_search: query });
  const shown = found.slice(0, FREE_SEARCH_MAX);
  const rows = shown.map((p) => [{ text: p.name.slice(0, 60), callback_data: `prod:${p.id}` }]);
  if (found.length > FREE_SEARCH_MAX)
    rows.push([{ text: b.m.showMore, callback_data: `searchmore:${FREE_SEARCH_MAX}` }]);
  await send(b, b.m.searchResults(escapeHtml(query), shown.length), {
    reply_markup: { inline_keyboard: rows },
  });
}

/** Умный поиск (LLM) — только когда обычный ничего не нашёл и продавец его включил. */
async function smartSearchFallback(b: Bot, query: string): Promise<Product[]> {
  const { smartSearchEnabled, consumeQuota, smartSearchProductIds } =
    await import("@/core/search/smart.server");
  if (!(await smartSearchEnabled(b.ctx))) return [];
  if (!(await consumeQuota(b.ctx, b.customer))) return [];
  const ids = await smartSearchProductIds(b.ctx, query);
  if (!ids?.length) return [];
  const { data, error: readErr } = await b.ctx.db
    .from("products")
    .select(PRODUCT_SELECT)
    .in("id", ids.slice(0, PAGE))
    .eq("is_active", true);
  if (readErr) throw serverFailure(`[telegram] товары не прочитаны: ${readErr.message}`);
  const byId = new Map(((data ?? []) as unknown as Product[]).map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
}
