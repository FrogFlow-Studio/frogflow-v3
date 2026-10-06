import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { shownLeadDays } from "@/core/catalog/lead-time";
import { sortedImages, sortedVariants, imageUrl, type Product } from "@/core/catalog/catalog";
import { resolvePrice, strikePrice } from "@/core/pricing/pricing";
import { formatRatingSummary } from "@/core/reviews/pure";
import { formatMoney } from "@/core/money/money";
import { verticalDef } from "@/core/verticals/registry";
import { storefrontBase } from "@/core/tenant/custom-domain";
import { localeFlags, localeNames, SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { getPreorder } from "@/core/preorder/preorder";
import { bundleCardInfo, bundleCardLines } from "@/core/bundles/card";
import { COPY, escapeHtml } from "./copy";
import {
  STANDARD as BOT_TEXT_STANDARD,
  customFilled,
  fillText,
  hhmm,
  type WorkHours,
} from "@/core/bot-texts/registry";
import type { InlineButton, InlineKeyboard } from "./types";

/**
 * Экраны бота, которые видит покупатель: приветствие по /start, нижнее
 * меню и карточка товара. Их собирает и обработчик бота, и предпросмотр в
 * админке, поэтому здесь ничего не отправляется и ничего не пишется —
 * только текст (HTML Telegram) и кнопки.
 */

export type MenuButton = { text: string; web_app?: { url: string } };
export type MainMenu = { keyboard: MenuButton[][]; resize_keyboard: true };

/**
 * Нижнее меню бота. `sells` — продаёт ли клиент сейчас (core/tenant/sells):
 * консультант без товаров (BOVI) не видит каталога, поиска, корзины, заказов
 * и витрины — на вопросы отвечает консультант.
 */
export function mainMenu(tenant: Tenant, locale: Locale, appUrl: string, sells = true): MainMenu {
  const def = verticalDef(tenant.vertical);
  const m = COPY[locale];
  // Онлайн-школа: «Мои курсы» — первая кнопка, каталог — «Все курсы».
  const school = tenant.vertical === "courses" && tenant.modules.courses;
  const keyboard: MenuButton[][] = [
    ...(school ? [[{ text: m.myCourses }]] : []),
    ...(sells
      ? [
          [{ text: school ? m.catalogCourses : m.catalog }, { text: m.search }],
          [{ text: m.cart }, { text: m.myOrders }],
        ]
      : []),
    // «Информация» ведёт на юр. страницы — только при модуле legal_docs.
    tenant.modules.legal_docs
      ? [{ text: m.instruction }, { text: m.information }]
      : [{ text: m.instruction }],
    ...(tenant.modules.referral ? [[{ text: m.inviteFriendBtn }]] : []),
    // Модуль «Поддержка»: рядом со связью — «Мои обращения».
    tenant.modules.helpdesk
      ? [{ text: def.locales[locale].contactBtn }, { text: m.myTicketsBtn }]
      : [{ text: def.locales[locale].contactBtn }],
  ];
  if (tenant.modules.quiz) keyboard.splice(1, 0, [{ text: m.quizBtn }]);
  // Онлайн-школа: уроки, задания и канал курса — отдельной кнопкой под заказами.
  if (tenant.modules.courses && !school)
    keyboard.splice(keyboard.length - 2, 0, [{ text: m.myCourses }]);
  if (sells && tenant.modules.telegram_mini_app && tenant.modules.shop) {
    keyboard.unshift([{ text: m.shopAppBtn, web_app: { url: storefrontBase(tenant, appUrl) } }]);
  }
  return { keyboard, resize_keyboard: true };
}

/** Приветствие после выбора языка; shopName — настройка shop_name или имя клиента. */
export function welcomeHtml(tenant: Tenant, shopName: string, locale: Locale): string {
  const custom = customFilled(tenant, "welcome", "telegram", locale, { shop: shopName });
  if (custom !== null) return escapeHtml(custom);
  const v = verticalDef(tenant.vertical).locales[locale];
  return (
    `<b>${escapeHtml(shopName)}</b>\n${escapeHtml(v.welcomeGreeting)}\n\n` +
    `→ ${escapeHtml(v.welcomeCatalog)}\n→ ${escapeHtml(v.welcomePayment)}`
  );
}

/** «Не понял» вместо стандартной подсказки, если продавец написал свой текст. */
export function notUnderstoodHtml(tenant: Tenant, locale: Locale): string {
  const custom = customFilled(tenant, "not_understood", "telegram", locale);
  return custom === null ? COPY[locale].useMenu : escapeHtml(custom);
}

/** «Спасибо за заказ» — только свой текст продавца; null — сообщение не отправляется. */
export function orderThanksHtml(
  tenant: Tenant,
  locale: Locale,
  no: number | string,
): string | null {
  const custom = customFilled(tenant, "order_thanks", "telegram", locale, { order: String(no) });
  return custom === null ? null : escapeHtml(custom);
}

/** «Вне часов работы»: свой текст или стандартный, с часами работы магазина. */
export function offHoursHtml(tenant: Tenant, locale: Locale, hours: WorkHours): string {
  const vars = { from: hhmm(hours.open), to: hhmm(hours.close) };
  return escapeHtml(
    customFilled(tenant, "off_hours", "telegram", locale, vars) ??
      fillText(BOT_TEXT_STANDARD.off_hours![locale], vars),
  );
}

/** Выбор языка по /start при модуле multi_language. */
export function languageChoice(): InlineButton[][] {
  return SUPPORTED_LOCALES.map((l) => [
    { text: `${localeFlags[l]} ${localeNames[l]}`, callback_data: `locale:${l}` },
  ]);
}

/** Кнопка «Сообщить о поступлении» — только с модулем waitlist. */
export function waitlistRow(
  tenant: Tenant,
  locale: Locale,
  productId: string,
): InlineKeyboard["inline_keyboard"] {
  return tenant.modules.waitlist
    ? [[{ text: COPY[locale].waitlistBtn, callback_data: `wait:${productId}` }]]
    : [];
}

export type ProductCard = {
  /** HTML Telegram; в подпись к фото уходят первые 1024 символа. */
  caption: string;
  keyboard: InlineKeyboard;
  /** Публичная ссылка на первое фото; null — карточка уходит текстом. */
  photo: string | null;
};

/**
 * Карточка товара: цена по стране покупателя и акции, срок изготовления,
 * оценка, наличие и кнопки вариантов или «В корзину». Только чтение.
 */
export async function productCard(
  ctx: TenantContext,
  p: Product,
  locale: Locale,
  country: string | null,
): Promise<ProductCard> {
  const m = COPY[locale];
  const t = ctx.tenant;
  const imgs = sortedImages(p);
  const variants = sortedVariants(p);
  const desc = p.description ? `\n\n${escapeHtml(p.description)}` : `\n\n<i>${m.descPending}</i>`;
  // Нет в наличии, но продавец берёт предзаказ (core/preorder): кнопки покупки остаются.
  // Набор (модуль bundles): предзаказ и лист ожидания для него не предлагаем.
  const bundle = await bundleCardInfo(ctx, p.id);
  // Остаток набора — по составляющим (core/bundles/stock), у остальных — свой.
  const stockedOut = bundle
    ? bundle.capacity === 0
    : t.modules.stock && p.stock_quantity != null && p.stock_quantity <= 0;
  const preorder = stockedOut && !bundle ? await getPreorder(ctx, p.id) : null;
  const outOfStock = stockedOut && !preorder;
  const waitRows = bundle ? [] : waitlistRow(t, locale, p.id);
  let caption: string;
  let keyboard: InlineKeyboard;
  if (variants.length > 0) {
    const priced = await Promise.all(
      variants.map(async (v) => ({ v, money: await resolvePrice(ctx, p, country, v) })),
    );
    const min = Math.min(...priced.map((r) => r.money.amount));
    const currency = priced[0]?.money.currency ?? p.currency;
    caption = `📦 <b>${escapeHtml(p.name)}</b>${desc}\n\n💰 <b>${m.priceFrom(formatMoney(min, currency))}</b>`;
    keyboard = {
      inline_keyboard: outOfStock
        ? waitRows
        : priced.map(({ v, money }) => [
            {
              text: `${v.name} — ${formatMoney(money.amount, money.currency)}`,
              callback_data: `add:${p.id}:${v.id}`,
            },
          ]),
    };
  } else {
    const { price: money, old } = await strikePrice(ctx, p, country);
    // Акция: прежняя цена зачёркнута, рядом новая.
    const was = old != null ? `<s>${formatMoney(old, money.currency)}</s> ` : "";
    caption = `📦 <b>${escapeHtml(p.name)}</b>${desc}\n\n💰 ${was}<b>${formatMoney(money.amount, money.currency)}</b>`;
    keyboard = {
      inline_keyboard: outOfStock
        ? waitRows
        : [[{ text: m.addToCartBtn, callback_data: `add:${p.id}` }]],
    };
  }
  if (bundle) {
    caption += `\n\n${escapeHtml(bundleCardLines(bundle, locale).join("\n"))}`;
    // Составляющая вышла из продажи — покупать набор нельзя.
    if (!bundle.available) keyboard = { inline_keyboard: [] };
  }
  const leadDays = shownLeadDays(p);
  if (leadDays) caption += `\n${m.leadTimeLabel(leadDays)}`;
  // Рейтинг — только одобренные отзывы, как на витрине (колонки products.rating_* считают все).
  const approved =
    t.modules.review_request && p.rating_count
      ? await (await import("@/core/reviews/photos.server")).approvedRating(ctx, p.id)
      : null;
  const rating = approved ? formatRatingSummary(approved.avg, approved.count) : null;
  if (rating) caption += `\n${rating}`;
  if (preorder) caption += `\n${m.preorderLabel(preorder.from)}`;
  else if (outOfStock) caption += `\n${m.outOfStockLabel}`;
  else if (t.modules.limited_offers) {
    const { offerForProductRow, offerLabel } = await import("@/core/offers/offers");
    const offer = await offerForProductRow(ctx, p);
    if (offer) caption += `\n<b>${offerLabel(offer, ctx.timezone, locale)}</b>`;
  }
  // «Осталось N шт.» — только с согласия продавца и без предзаказа (core/catalog/low-stock).
  const { buyerLowStock } = await import("@/core/catalog/low-stock");
  const left = await buyerLowStock(ctx, p);
  if (left !== null) caption += `\n${m.lowStockLabel(left)}`;
  // Курс (модуль courses): уроков, старт потока; набор закрыт — без кнопок покупки.
  if (t.modules.courses && p.fulfillment_kind !== "physical") {
    const { coursePreview } = await import("@/core/courses/preview.server");
    const course = await coursePreview(ctx, p.id);
    if (course) {
      // Открытые уроки — кнопками под карточкой: содержимое до покупки.
      const openRows = course.lessons
        .filter((l) => l.open)
        .slice(0, 5)
        .map((l) => [
          {
            text: `🔓 ${COURSE_CARD[locale].openLesson(l.no, l.title)}`.slice(0, 60),
            callback_data: `opl:${p.id}:${l.no}`,
          },
        ]);
      caption += `\n${COURSE_CARD[locale].lessons(course.lessons.length)}`;
      if (course.cohort) {
        const day = new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "long",
          timeZone: ctx.timezone,
        }).format(new Date(course.cohort.start));
        caption += `\n${COURSE_CARD[locale].start(escapeHtml(course.cohort.title), day)}`;
      }
      if (!course.enrollOpen) {
        caption += `\n<b>${COURSE_CARD[locale].closed}</b>`;
        keyboard = { inline_keyboard: [] };
      }
      if (openRows.length)
        keyboard = { inline_keyboard: [...openRows, ...(keyboard.inline_keyboard ?? [])] };
    }
  }
  return { caption, keyboard, photo: imgs[0] ? imageUrl(ctx, imgs[0].image_path) : null };
}

const COURSE_CARD: Record<
  Locale,
  {
    lessons: (n: number) => string;
    start: (title: string, day: string) => string;
    closed: string;
    openLesson: (no: number, title: string) => string;
  }
> = {
  ru: {
    lessons: (n) => `🎓 Уроков в курсе: ${n}`,
    start: (title, day) => `🗓 Поток «${title}» — старт ${day}`,
    closed: "Набор закрыт",
    openLesson: (no, title) => `Открытый урок ${no}: ${title}`,
  },
  kk: {
    lessons: (n) => `🎓 Курстағы сабақтар: ${n}`,
    start: (title, day) => `🗓 «${title}» ағыны — басталуы ${day}`,
    closed: "Қабылдау жабық",
    openLesson: (no, title) => `Ашық сабақ ${no}: ${title}`,
  },
  en: {
    lessons: (n) => `🎓 Lessons in the course: ${n}`,
    start: (title, day) => `🗓 Cohort «${title}» — starts ${day}`,
    closed: "Enrolment closed",
    openLesson: (no, title) => `Open lesson ${no}: ${title}`,
  },
  uz: {
    lessons: (n) => `🎓 Kursdagi darslar: ${n}`,
    start: (title, day) => `🗓 «${title}» oqimi — boshlanishi ${day}`,
    closed: "Qabul yopilgan",
    openLesson: (no, title) => `Ochiq dars ${no}: ${title}`,
  },
};
