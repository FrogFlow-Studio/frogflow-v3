import { shownLeadDays } from "@/core/catalog/lead-time";
import type { Json } from "@/core/db-types";
import { type Locale } from "@/core/i18n/locale";
import {
  getProduct,
  listChildCategories,
  listProductsInCategory,
  productsByKeywordTag,
  searchProducts,
  sortedImages,
  sortedVariants,
  type Product,
} from "@/core/catalog/catalog";
import { addToCart } from "@/core/cart/cart";
import { formatMoney } from "@/core/money/money";
import { resolvePrice, strikePrice } from "@/core/pricing/pricing";
import { formatRatingSummary } from "@/core/reviews/pure";
import { loadQuiz } from "@/core/quiz/quiz";
import { IG_BUTTONS_TEXT_MAX, type DmButton } from "../api.server";
import { type ZernioPlatform } from "../platform";
import {
  rowSubtitle,
  whatsappList,
  STEP_PREFIX,
  WA_LIST_PAGE,
  MULTI_ADD_COPY,
  ONE_SECTION_HINT,
  PRODUCT_LIST_HINT,
  plain,
  productNumberFromKeywords,
  productNumberFromName,
} from "../shop-flow";
import { serverFailure } from "@/lib/server-failure";
import {
  BTN,
  LIST_TTL_MS,
  PAGE,
  type Shop,
  hint,
  inDialog,
  memory,
  photoFor,
  remember,
  reply,
} from "./context.server";
import { askCountryFirst } from "./route.server";
import { showCart } from "./cart.server";

// ── каталог ───────────────────────────────────────────────────────────

/** Пункт списка разделов: «товары самого раздела», когда у раздела есть и подразделы, и свои товары. */
const OWN_PRODUCTS_PREFIX = "~p:";

const OWN_PRODUCTS_LABEL: Record<Locale, string> = {
  ru: "Товары этого раздела",
  kk: "Осы бөлімнің тауарлары",
  en: "Products in this section",
  uz: "Shu bo‘lim mahsulotlari",
};

/** Открыть пункт списка разделов: подраздел или товары самого раздела. */
function openEntry(s: Shop, id: string) {
  return id.startsWith(OWN_PRODUCTS_PREFIX)
    ? showCatalog(s, id.slice(OWN_PRODUCTS_PREFIX.length), 0, true, true)
    : showCatalog(s, id, 0, true);
}

export async function showCatalog(
  s: Shop,
  categoryId: string | null,
  offset: number,
  force: boolean,
  ownProductsOnly = false,
) {
  const children = ownProductsOnly ? [] : await listChildCategories(s.ctx, categoryId);
  // Раздел с подразделами и своими товарами: товары не теряем, а даём последним пунктом.
  const own =
    categoryId && children.length > 0 ? await listProductsInCategory(s.ctx, categoryId) : [];
  const cats = children.map((c) => ({ id: c.id, name: c.name }));
  if (categoryId && own.length > 0)
    cats.push({
      id: `${OWN_PRODUCTS_PREFIX}${categoryId}`,
      name: OWN_PRODUCTS_LABEL[s.locale] ?? OWN_PRODUCTS_LABEL.ru,
    });
  if (cats.length > 0) {
    const PAGE = pageSize(s);
    const page = cats.slice(offset, offset + PAGE);
    const lines = page.map((c, i) => `${offset + i + 1}. ${c.name}`);
    const more = cats.length > offset + PAGE;
    await remember(s, {
      list: {
        kind: "categories",
        ids: cats.slice(0, offset + PAGE).map((c) => c.id),
        at: new Date().toISOString(),
      },
    });
    const buttons: DmButton[] = [];
    if (more)
      buttons.push({
        type: "postback",
        title: plain(s.m.showMore),
        payload: `CAT:${categoryId ?? ""}:${offset + PAGE}`,
      });
    buttons.push(BTN.cart(s.m));
    // Корень каталога: подбор товара, если продавец настроил квиз (кнопок не больше трёх).
    if (!categoryId && s.ctx.tenant.modules.quiz && (await loadQuiz(s.ctx)).questions.length)
      buttons.push(BTN.quiz(s.m));
    if (categoryId)
      buttons.push({
        type: "postback",
        title: plain(s.m.backToCategories),
        payload: await backPayload(s, categoryId),
      });
    if (s.platform === "whatsapp") {
      await reply(s, plain(s.m.catalogHeader), {
        force,
        interactive: whatsappList({
          body: plain(s.m.catalogHeader),
          buttonLabel: plain(s.m.openCatalogBtn),
          sections: [
            {
              title: plain(s.m.catalogHeader),
              rows: page.map((c) => ({
                id: c.id.startsWith(OWN_PRODUCTS_PREFIX)
                  ? `PCAT:${c.id.slice(OWN_PRODUCTS_PREFIX.length)}:0`
                  : `CAT:${c.id}:0`,
                title: c.name,
              })),
            },
            { title: "…", rows: buttons.map((b) => ({ id: b.payload!, title: b.title })) },
          ],
        }),
      });
      return;
    }
    await reply(
      s,
      `${plain(s.m.catalogHeader)}\n\n${lines.join("\n")}\n\n${s.locale === "ru" ? "Напишите номер раздела." : plain(s.m.chooseSection)}`,
      { force, buttons: buttons.slice(0, 3) },
    );
    return;
  }
  const products = await listProductsInCategory(s.ctx, categoryId);
  if (products.length === 0) {
    await reply(s, s.m.emptyHere, { force, buttons: [BTN.catalog(s.m), BTN.cart(s.m)] });
    return;
  }
  await showProductList(s, products, offset, categoryId, force, ownProductsOnly);
}

export async function showProductList(
  s: Shop,
  products: Product[],
  offset: number,
  categoryId: string | null,
  force: boolean,
  own = false,
) {
  // Товары раздела с подразделами: «ещё» остаётся в списке товаров, «назад» — в сам раздел.
  const pageHead = own ? "PCAT" : "CAT";
  const country = s.customer.state.country_code ?? null;
  const PAGE = pageSize(s);
  const page = products.slice(offset, offset + PAGE);
  const prices = await Promise.all(
    page.map(async (p) => {
      const variants = sortedVariants(p);
      const money = variants.length
        ? await resolvePrice(s.ctx, p, country, variants[0])
        : await resolvePrice(s.ctx, p, country);
      return variants.length
        ? plain(s.m.priceFrom(formatMoney(money.amount, money.currency)))
        : formatMoney(money.amount, money.currency);
    }),
  );
  const lines = page.map((p, i) => `${offset + i + 1}. ${p.name} — ${prices[i]}`);
  await remember(s, {
    list: {
      kind: "products",
      ids: products.slice(0, offset + PAGE).map((p) => p.id),
      at: new Date().toISOString(),
    },
  });
  const buttons: DmButton[] = [];
  if (products.length > offset + PAGE)
    buttons.push({
      type: "postback",
      title: plain(s.m.showMore),
      payload: `${pageHead}:${categoryId ?? ""}:${offset + PAGE}`,
    });
  buttons.push(BTN.cart(s.m));
  buttons.push(
    categoryId
      ? {
          type: "postback",
          title: plain(s.m.backToCategories),
          payload: own ? `CAT:${categoryId}:0` : await backPayload(s, categoryId),
        }
      : BTN.orders(s.m),
  );
  if (s.platform === "whatsapp") {
    await reply(s, plain(s.m.catalogHeader), {
      force,
      interactive: whatsappList({
        body: plain(s.m.catalogHeader),
        buttonLabel: plain(s.m.openCatalogBtn),
        sections: [
          {
            title: plain(s.m.catalog),
            rows: page.map((p, i) => ({
              id: `PROD:${p.id}`,
              title: p.name,
              description: rowSubtitle(p.name, prices[i] ?? ""),
            })),
          },
          { title: "…", rows: buttons.map((b) => ({ id: b.payload!, title: b.title })) },
        ],
      }),
    });
    return;
  }
  await reply(s, `${lines.join("\n")}\n\n${PRODUCT_LIST_HINT[s.locale]}`, {
    force,
    buttons: buttons.slice(0, 3),
  });
}

/**
 * «Назад» из раздела — к его родителю, а у раздела верхнего уровня — в
 * корень. Раньше всегда вёл в корень: из раздела второго уровня покупатель
 * терял место и начинал с начала.
 */
async function backPayload(s: Shop, categoryId: string): Promise<string> {
  const { data, error: readErr } = await s.ctx.db
    .from("categories")
    .select("parent_id")
    .eq("id", categoryId)
    .maybeSingle();
  if (readErr) throw serverFailure(`[zernio] категория не прочитана: ${readErr.message}`);
  return data?.parent_id ? `CAT:${data.parent_id}:0` : "CATALOG";
}

/** Список WhatsApp вмещает десять строк с навигацией; в Instagram — нумерованный текст. */
function pageSize(s: Shop): number {
  return s.platform === "whatsapp" ? WA_LIST_PAGE : PAGE;
}

/** Шаг сценария списком WhatsApp: строки «STEP:<n>» разбираются как набранная цифра. */
export function stepList(
  body: string,
  buttonLabel: string,
  section: string,
  titles: string[],
): Json {
  return whatsappList({
    body,
    buttonLabel,
    sections: [
      { title: section, rows: titles.map((title, i) => ({ id: `${STEP_PREFIX}${i + 1}`, title })) },
    ],
  });
}

/** Номер: из показанного списка, иначе — номер товара из названия/ключевых слов, иначе поиск. */
/** true — бот ответил; false — номер ни к чему не подошёл, а строгий режим промолчал. */
export async function pickByNumber(s: Shop, number: string): Promise<boolean> {
  const mem = memory(s.customer);
  const list = mem.list;
  const listFresh = list && Date.now() - Date.parse(list.at) < LIST_TTL_MS;
  const n = Number(number);
  if (listFresh && list.kind !== "variants" && n >= 1 && n <= list.ids.length) {
    const id = list.ids[n - 1]!;
    if (list.kind === "categories") return openEntry(s, id).then(() => true);
    const p = await getProduct(s.ctx, id);
    if (p) return sendProductCard(s, p, true).then(() => true);
  }
  // Номер из поста: «018. Набор …» — ищем по началу названия и по ключевым словам.
  const padded = Array.from(new Set([number, number.padStart(2, "0"), number.padStart(3, "0")]));
  const candidates: Product[] = [];
  for (const q of padded) {
    for (const p of await searchProducts(s.ctx, q, 30)) {
      if (
        productNumberFromName(p.name) === number ||
        productNumberFromKeywords(p.keywords) === number
      )
        candidates.push(p);
    }
    if (candidates.length) break;
  }
  const p = candidates[0];
  if (p) {
    if (!(await askCountryFirst(s, `product:${p.id}`))) await sendProductCard(s, p, true);
    return true;
  }
  // Номер, которого нет в каталоге, в строгом режиме — обычная реплика («2» продавцу).
  if (!inDialog(s)) return false;
  await reply(s, `${plain(s.m.productNotFound)}\n\n${hint(s)}`, {
    buttons: [BTN.catalog(s.m), BTN.cart(s.m)],
  });
  return true;
}

/**
 * Несколько номеров одним сообщением («2 4 7», «2, 4, 7»). Ответ на список
 * разделов — открываем первый; на список товаров или коды — кладём в
 * корзину всё, что без выбора варианта, и показываем корзину.
 */
export async function pickSeveral(s: Shop, numbers: string[]): Promise<boolean> {
  const list = memory(s.customer).list;
  const listFresh = list && Date.now() - Date.parse(list.at) < LIST_TTL_MS;
  if (listFresh && list.kind === "categories") {
    const idx = numbers.map(Number).find((n) => n >= 1 && n <= list.ids.length);
    if (idx) {
      await reply(s, ONE_SECTION_HINT[s.locale], { force: true });
      await openEntry(s, list.ids[idx - 1]!);
      return true;
    }
  }
  const found: Product[] = [];
  const missing: string[] = [];
  for (const number of numbers) {
    const n = Number(number);
    const fromList =
      listFresh && list.kind === "products" && n >= 1 && n <= list.ids.length
        ? await getProduct(s.ctx, list.ids[n - 1]!)
        : null;
    const p = fromList ?? (await productByCode(s, number));
    if (p && !found.some((x) => x.id === p.id)) found.push(p);
    else if (!p) missing.push(number);
  }
  if (found.length === 0) {
    if (!inDialog(s)) return false;
    await reply(s, `${plain(s.m.productNotFound)}\n\n${hint(s)}`, {
      buttons: [BTN.catalog(s.m), BTN.cart(s.m)],
    });
    return true;
  }
  const withVariants = found.filter((p) => sortedVariants(p).length > 0);
  let added = 0;
  const failed: string[] = [];
  for (const p of found.filter((x) => sortedVariants(x).length === 0)) {
    const r = await addToCart(s.ctx, s.customer, p.id, null);
    if (r === "ok") added++;
    else failed.push(p.name);
  }
  const copy = MULTI_ADD_COPY[s.locale];
  const notes = [
    missing.length ? copy.notFound(missing) : "",
    failed.length ? `${plain(s.m.unavailable).replace(/[.!]\s*$/, "")}: ${failed.join("; ")}` : "",
    withVariants.length ? copy.needsVariant(withVariants.map((p) => p.name)) : "",
  ].filter(Boolean);
  if (added === 0) {
    await reply(s, notes.join("\n") || plain(s.m.unavailable), {
      force: true,
      buttons: [BTN.cart(s.m), BTN.catalog(s.m)],
    });
    return true;
  }
  await showCart(s, true, [plain(s.m.added), ...notes].join("\n"));
  return true;
}

/**
 * «#кпп»: товары, у которых метка стоит в ключевых словах. Один — карточка,
 * несколько — список с номерами (страница каталога), ни одного — false:
 * метку никто не заводил, реплика остаётся продавцу, как и до неё.
 */
export async function pickByTag(s: Shop, tag: string): Promise<boolean> {
  const found = await productsByKeywordTag(s.ctx, tag);
  if (found.length === 0) return false;
  if (found.length === 1) {
    const p = found[0]!;
    if (!(await askCountryFirst(s, `product:${p.id}`))) await sendProductCard(s, p, true);
    return true;
  }
  await showProductList(s, found.slice(0, pageSize(s)), 0, null, true);
  return true;
}

/** Товар по коду из названия или ключевых слов: «018. Набор …». */
async function productByCode(s: Shop, number: string): Promise<Product | null> {
  const padded = Array.from(new Set([number, number.padStart(2, "0"), number.padStart(3, "0")]));
  for (const q of padded) {
    for (const p of await searchProducts(s.ctx, q, 30))
      if (
        productNumberFromName(p.name) === number ||
        productNumberFromKeywords(p.keywords) === number
      )
        return p;
  }
  return null;
}

/**
 * Описание — после названия, сколько влезет: с кнопками Instagram берёт не
 * больше 640 знаков текста, и длинное описание раньше съедало цену и кнопки
 * (сообщение отклонялось целиком: «Купить» молчал, Копилка русоведа 09.10).
 */
export function withDescription(
  card: string,
  description: string,
  platform: ZernioPlatform,
): string {
  if (!description) return card;
  const [name, ...rest] = card.split("\n\n");
  const tail = rest.length ? `\n\n${rest.join("\n\n")}` : "";
  const max = platform === "instagram" ? IG_BUTTONS_TEXT_MAX : 1000;
  const room = Math.min(600, max - plain(`${name}${tail}`).length - 4);
  if (room < 40) return card;
  const desc =
    description.length > room ? `${description.slice(0, room - 1).trimEnd()}…` : description;
  return `${name}\n\n${desc}${tail}`;
}

export async function sendProductCard(s: Shop, p: Product, force: boolean) {
  const country = s.customer.state.country_code ?? null;
  const variants = sortedVariants(p);
  const imgs = sortedImages(p);
  // Нет в наличии, но продавец берёт предзаказ (core/preorder): кнопки покупки остаются.
  const { getPreorder } = await import("@/core/preorder/preorder");
  // Набор (модуль bundles): предзаказ и лист ожидания для него не предлагаем.
  const { bundleCardInfo, bundleCardLines } = await import("@/core/bundles/card");
  const bundle = await bundleCardInfo(s.ctx, p.id);
  // Остаток набора — по составляющим (core/bundles/stock), у остальных — свой.
  const stockedOut = bundle
    ? bundle.capacity === 0
    : s.ctx.tenant.modules.stock && p.stock_quantity != null && p.stock_quantity <= 0;
  const preorder = stockedOut && !bundle ? await getPreorder(s.ctx, p.id) : null;
  const outOfStock = stockedOut && !preorder;
  // Кнопок покупки нет: товара нет в наличии или в наборе недоступна составляющая.
  const noBuy = outOfStock || (bundle != null && !bundle.available);
  const description = p.description?.trim() ?? "";
  let text = p.name;
  const buttons: DmButton[] = [];
  let variantList: string[] = [];
  if (variants.length > 0) {
    const priced = await Promise.all(
      variants.map(async (v) => ({ v, money: await resolvePrice(s.ctx, p, country, v) })),
    );
    const min = Math.min(...priced.map((r) => r.money.amount));
    const currency = priced[0]?.money.currency ?? p.currency;
    text += `\n\n${plain(s.m.priceFrom(formatMoney(min, currency)))}`;
    if (!noBuy) {
      if (priced.length <= 2) {
        for (const { v, money } of priced)
          buttons.push({
            type: "postback",
            title: `${v.name} — ${formatMoney(money.amount, money.currency)}`.slice(0, 20),
            payload: `BUY:${p.id}:${v.id}`,
          });
      } else {
        variantList = priced.map(
          ({ v, money }, i) => `${i + 1}. ${v.name} — ${formatMoney(money.amount, money.currency)}`,
        );
        text += `\n\n${variantList.join("\n")}\n\n${s.locale === "ru" ? "Напишите номер варианта." : plain(s.m.chooseSection)}`;
      }
    }
  } else {
    const { price: money, old } = await strikePrice(s.ctx, p, country);
    // Директ без разметки: прежняя цена словами, «было … → стало …».
    text += `\n\n${old != null ? `${formatMoney(old, money.currency)} → ` : ""}${formatMoney(money.amount, money.currency)}`;
    if (!noBuy)
      buttons.push({ type: "postback", title: plain(s.m.addToCartBtn), payload: `BUY:${p.id}` });
  }
  if (outOfStock && !bundle && s.ctx.tenant.modules.waitlist)
    buttons.push({
      type: "postback",
      title: plain(s.m.waitlistBtn).slice(0, 20),
      payload: `WAIT:${p.id}`,
    });
  if (bundle) {
    text += `\n\n${bundleCardLines(bundle, s.locale).join("\n")}`;
  }
  const leadDays = shownLeadDays(p);
  if (leadDays) text += `\n${plain(s.m.leadTimeLabel(leadDays))}`;
  // Рейтинг — только одобренные отзывы, как на витрине (колонки products.rating_* считают все).
  const approved =
    s.ctx.tenant.modules.review_request && p.rating_count
      ? await (await import("@/core/reviews/photos.server")).approvedRating(s.ctx, p.id)
      : null;
  const rating = approved ? formatRatingSummary(approved.avg, approved.count) : null;
  if (rating) text += `\n${plain(rating)}`;
  if (preorder) text += `\n${plain(s.m.preorderLabel(preorder.from))}`;
  else if (outOfStock) text += `\n${plain(s.m.outOfStockLabel)}`;
  else if (s.ctx.tenant.modules.limited_offers) {
    const { offerForProductRow, offerLabel } = await import("@/core/offers/offers");
    const offer = await offerForProductRow(s.ctx, p);
    if (offer) text += `\n${offerLabel(offer, s.ctx.timezone, s.locale)}`;
  }
  // «Осталось N шт.» — только с согласия продавца и без предзаказа (core/catalog/low-stock).
  const { buyerLowStock } = await import("@/core/catalog/low-stock");
  const left = await buyerLowStock(s.ctx, p);
  if (left !== null) text += `\n${plain(s.m.lowStockLabel(left))}`;
  buttons.push(BTN.cart(s.m));
  if (buttons.length < 3) buttons.push(BTN.catalog(s.m));

  if (variantList.length) {
    await remember(
      s,
      {
        variant_product: p.id,
        list: { kind: "variants", ids: variants.map((v) => v.id), at: new Date().toISOString() },
      },
      { mode: "awaiting_variant_choice" },
    );
  }
  const attachmentUrl = await photoFor(
    s,
    imgs.map((i) => i.image_path),
  );
  await reply(s, withDescription(text, description, s.platform), {
    force,
    buttons: buttons.slice(0, 3),
    attachmentUrl,
  });
}
