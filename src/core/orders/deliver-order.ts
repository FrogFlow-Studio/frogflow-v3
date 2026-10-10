import { rewardReferrerIfFirstDelivery, type ReferralGrant } from "@/core/referrals/referrals";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { protectMaterials } from "@/core/delivery/watermark.server";
import { recordOrderEvent } from "./events";
import { serviceDb } from "@/core/db/client.server";
import { isSafeStorageKey } from "@/core/storage/keys";
import {
  type MaterialSnapshot,
  addDeliveredLanguage,
  isDeliveryLangChoice,
  parseDeliveredLanguages,
} from "@/core/catalog/materials";
import { localeNames, type Locale } from "@/core/i18n/locale";
import {
  itemAvailableLanguages,
  itemMaterials,
  itemNeedsLanguageChoice,
  orderChannel,
  withDownloadName,
} from "./pure";
import { awardPointsForOrder } from "@/core/discounts/discounts";
import { serverFailure } from "@/lib/server-failure";
import { type OrderItemRow, type OrderWithItems } from "./order-model";
import { getOrder } from "./order-queries";
import { claimOrderForDelivery } from "./reject-order";

/** Выдача материалов: доставка, выбор языка, ссылки на файлы, почта. */

type IssuedGift = import("@/core/discounts/gift-sale").IssuedGift;

export type MaterialSender = (
  item: OrderItemRow,
  materials: MaterialSnapshot[],
) => Promise<"sent" | "failed">;

/** Спросить покупателя, на каком языке выдать позицию; true — вопрос отправлен. */
export type LanguageAsker = (item: OrderItemRow, langs: Locale[]) => Promise<boolean>;

export type DeliverOptions = {
  /** Язык интерфейса покупателя — им выдаём, если выбора нет и он доступен. */
  lang?: Locale;
  /** Канал умеет спросить язык при выдаче (Telegram — кнопками). */
  ask?: LanguageAsker;
  /** Канал не умеет спрашивать (Direct, письмо) — при нескольких языках отдать все. */
  allWhenAmbiguous?: boolean;
  /** Кто запустил выдачу — для таймлайна заказа: bot (автоматически) или admin. */
  actor?: string;
};

export type DeliverResult = {
  ok: true;
  alreadyDelivered?: boolean;
  sent: number;
  failed: number;
  /** Позиции, по которым ждём ответа покупателя о языке: заказ остаётся «выдаётся». */
  pending: number;
  /** Начислено баллов за покупку (модуль loyalty), 0 — нет. */
  pointsEarned: number;
  /** Награда пригласившему (модуль referral) — каналу осталось её отправить. */
  referral?: ReferralGrant | null;
};

/** Ссылка на уроки, если позиция — курс (модуль courses); см. core/courses/delivery. */
async function courseLink(ctx: TenantContext, item: OrderItemRow): Promise<MaterialSnapshot[]> {
  if (!ctx.tenant.modules.courses) return [];
  const { courseMaterials } = await import("@/core/courses/delivery.server");
  const links = await courseMaterials(ctx, item);
  if (links.length) {
    // Прохождение — с выдачи: ученик потока получит сообщение о старте.
    const { startRunAtDelivery } = await import("@/core/courses/run.server");
    await startRunAtDelivery(ctx, item).catch(() => {});
  }
  return links;
}

/** Отметить язык выданным; возвращает новое значение колонки — следующий язык копится поверх него. */
async function markDelivered(
  ctx: TenantContext,
  item: OrderItemRow,
  current: string | null,
  lang: Locale,
): Promise<string> {
  const next = addDeliveredLanguage(current, lang);
  const marked = await ctx.db
    .from("order_items")
    .update({ delivered_language: next })
    .eq("id", item.id);
  if (marked.error)
    console.error(`[orders] язык выдачи позиции ${item.id} не записан: ${marked.error.message}`);
  return next;
}

/** Имя позиции с языком, когда языков у выдачи больше одного. */
export function itemLabel(item: OrderItemRow, lang: Locale, many: boolean): OrderItemRow {
  return many ? { ...item, name_snapshot: `${item.name_snapshot} (${localeNames[lang]})` } : item;
}

/**
 * Ход выдачи не записался: дальше не шлём, но заказ не оставляем в «delivering»
 * (его не берёт ни повтор, ни кнопки продавца). Переводим туда, откуда продавец
 * повторит выдачу, — «ждёт подтверждения» с пометкой и событием; best effort,
 * потом бросаем сбой.
 */
async function abortDelivery(
  ctx: TenantContext,
  order: OrderWithItems,
  remaining: number,
  total: number,
  dbMessage: string,
): Promise<never> {
  try {
    const { error } = await ctx.db
      .from("orders")
      .update({ status: "awaiting_confirmation", admin_note: "Выдача прервана: сбой базы" })
      .eq("id", order.id);
    if (error)
      console.error(`[orders] заказ #${order.id} не переведён после сбоя: ${error.message}`);
    await recordOrderEvent(ctx, order.id, "delivery_failed", { failed: remaining, total });
  } catch (e) {
    console.error(`[orders] разбор сбоя выдачи заказа #${order.id}: ${String(e)}`);
  }
  throw serverFailure(`Заказы: ход выдачи: ${dbMessage}`);
}

async function finalizeDelivery(
  ctx: TenantContext,
  order: OrderWithItems,
  failed: number,
  total: number,
  /** Заказ — покупка сертификата: баллов нет (их дадут за покупку сертификатом), код — письмом. */
  sale: { gift: IssuedGift | null } | null = null,
): Promise<{ pointsEarned: number; referral: ReferralGrant | null }> {
  const closed = await ctx.db
    .from("orders")
    .update(
      failed
        ? {
            status: "awaiting_confirmation",
            admin_note: `Выдача не удалась: ${failed} из ${total}`,
          }
        : { status: "delivered" },
    )
    .eq("id", order.id);
  // «Выдан» не записан — ни событий, ни баллов, ни награды: статус не врёт.
  if (closed.error) throw serverFailure(`Заказы: статус после выдачи: ${closed.error.message}`);
  await recordOrderEvent(
    ctx,
    order.id,
    failed ? "delivery_failed" : "delivered",
    failed ? { failed, total } : { sent: total },
  );
  const pointsEarned =
    failed || sale
      ? 0
      : await awardPointsForOrder(
          ctx,
          order.id,
          order.telegram_id,
          Number(order.total),
          order.currency,
        ).catch((e) => {
          // Заказ уже выдан: сбой начисления не рвёт выдачу (отметка снята — повторится).
          console.error(`[orders] баллы за заказ #${order.id}: ${String(e)}`);
          return 0;
        });
  // Покупка сертификата — не покупка у магазина: ни баллов, ни награды пригласившему;
  // награда придёт, когда покупатель получит обычный заказ.
  const referral =
    failed || sale
      ? null
      : await rewardReferrerIfFirstDelivery(ctx, order.telegram_id).catch((e) => {
          console.error(`[orders] награда пригласившему, заказ #${order.id}: ${String(e)}`);
          return null;
        });
  // Покупателю из Instagram/WhatsApp — копия материалов на почту: ссылки в
  // переписке живут 7 дней и теряются, письмо остаётся.
  if (!failed && sale?.gift) {
    const { emailGiftCode } = await import("@/core/discounts/gift-mail");
    await emailGiftCode(ctx, order, sale.gift).catch((e) =>
      console.warn(`[orders] письмо с сертификатом по заказу #${order.id}: ${String(e)}`),
    );
  } else if (!failed && orderChannel(order.platform) !== "telegram" && order.customer_email) {
    const fresh = await getOrder(ctx, order.id);
    const { emailOrderMaterials } = await import("./email");
    await emailOrderMaterials(ctx, fresh ?? order).catch((e) =>
      console.warn(`[orders] письмо по заказу #${order.id}: ${String(e)}`),
    );
  }
  return { pointsEarned, referral };
}

/**
 * Продавец сам выдал заказ (подтвердил чек, «Выдать») — деньги получены:
 * заказ считается оплаченным целиком, в журнале — платёж с суммой. Раньше у
 * ручных подтверждений paid_amount оставался 0, и выручка занижалась (Копилка,
 * AATeach, 10.10). Автоматическая выдача (actor «bot») идёт из «оплачен»: сумму
 * уже записали чек или шлюз. Условие — на прежний paid_amount: оплата шлюзом
 * в ту же секунду не запишется второй раз.
 */
async function recordManualConfirmation(
  ctx: TenantContext,
  order: OrderWithItems,
  actor: string | undefined,
): Promise<void> {
  if (!actor || actor === "bot" || actor === "system") return;
  const total = Number(order.total) || 0;
  const before = Number(order.paid_amount) || 0;
  const amount = Math.round((total - before) * 100) / 100;
  if (amount <= 0.01) return;
  const { data, error } = await ctx.db
    .from("orders")
    .update({ paid_amount: total })
    .eq("id", order.id)
    .eq("paid_amount", order.paid_amount ?? 0)
    .select("id");
  if (error) {
    console.error(
      `[orders] сумма ручного подтверждения #${order.id} не записана: ${error.message}`,
    );
    return;
  }
  if (!data?.length) return;
  order.paid_amount = total;
  await recordOrderEvent(
    ctx,
    order.id,
    "payment",
    {
      amount,
      currency: order.currency,
      source: "manual",
      ...(order.payment_proof_hash ? { ref: order.payment_proof_hash } : {}),
    },
    actor,
  ).catch((e) => console.error(`[orders] платёж #${order.id} не записан в журнал: ${String(e)}`));
}

/**
 * Выдача цифрового заказа. Канал приносит функцию отправки; ядро отвечает
 * за захват, порядок, статусы, delivery_index (сколько позиций уже ушло —
 * повторная выдача продолжает, а не дублирует) и языки: выбранный до
 * оформления язык или «все», уже выданные языки при повторе, вопрос
 * покупателю при выдаче (заказ остаётся «выдаётся», пока он не ответит),
 * иначе язык интерфейса или первый доступный.
 */
export async function deliverOrder(
  ctx: TenantContext,
  orderId: number,
  send: MaterialSender,
  opts: DeliverOptions = {},
): Promise<DeliverResult> {
  const order = await claimOrderForDelivery(ctx, orderId, opts.actor);
  if (!order)
    return { ok: true, alreadyDelivered: true, sent: 0, failed: 0, pending: 0, pointsEarned: 0 };
  await recordManualConfirmation(ctx, order, opts.actor);
  const multi = ctx.tenant.modules.multi_language;
  const choice =
    multi && isDeliveryLangChoice(order.delivery_lang_choice) ? order.delivery_lang_choice : null;
  const items = order.order_items.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // Покупка подарочного сертификата на сайте: позиция без товара, вместо
  // файлов — код (core/discounts/gift-sale), один на заказ.
  if (order.platform === "web" && items.length > 0 && items.every((i) => !i.product_id)) {
    const { giftSaleOf, issueGiftForOrder } = await import("@/core/discounts/gift-sale");
    if (await giftSaleOf(ctx, orderId)) {
      const gift = await issueGiftForOrder(ctx, order);
      const lang = opts.lang ?? ctx.tenant.settings.default_locale ?? "ru";
      for (const item of items) {
        if (gift) {
          await markDelivered(ctx, item, item.delivered_language, lang);
          await recordOrderEvent(ctx, orderId, "item_sent", { name: item.name_snapshot });
        } else
          await recordOrderEvent(ctx, orderId, "item_failed", {
            name: item.name_snapshot,
            reason: "не удалось создать код сертификата",
          });
      }
      const indexed = await ctx.db
        .from("orders")
        .update({ delivery_index: items.length })
        .eq("id", orderId);
      if (indexed.error)
        await abortDelivery(ctx, order, items.length, items.length, indexed.error.message);
      const failedGift = gift ? 0 : items.length;
      const fin = await finalizeDelivery(ctx, order, failedGift, items.length, { gift });
      return { ok: true, sent: items.length - failedGift, failed: failedGift, pending: 0, ...fin };
    }
  }
  let sent = 0;
  let failed = 0;
  let pending = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const langs = itemAvailableLanguages(item, multi);
    const delivered = parseDeliveredLanguages(item.delivered_language);
    let result: "sent" | "failed" | "pending" = "failed";
    const sendLangs = async (list: Locale[]) => {
      let ok = true;
      let current = item.delivered_language;
      // Ссылка на курс — один раз на позицию, с первым выданным языком.
      let course = delivered.size === 0 ? await courseLink(ctx, item) : [];
      for (const l of list) {
        const materials = itemMaterials(item, l);
        if (materials.length === 0) continue;
        const payload = [...(await protectMaterials(ctx, order, materials)), ...course];
        course = [];
        // Курс без уроков или без адреса витрины: отправлять нечего — сбой
        // выдачи, продавец увидит его, а покупатель не получит пустое сообщение.
        const r = payload.length
          ? await send(itemLabel(item, l, list.length > 1), payload)
          : "failed";
        if (r === "sent") {
          current = await markDelivered(ctx, item, current, l);
          await recordOrderEvent(ctx, orderId, "item_sent", { name: item.name_snapshot, lang: l });
        } else {
          ok = false;
          await recordOrderEvent(ctx, orderId, "item_failed", {
            name: item.name_snapshot,
            lang: l,
            reason: "канал не доставил файл",
          });
        }
      }
      return ok ? ("sent" as const) : ("failed" as const);
    };
    if (langs.length === 0) result = "failed";
    else if (choice === "all") result = await sendLangs(langs);
    else if (choice) result = await sendLangs([langs.includes(choice) ? choice : langs[0]!]);
    else if (multi && delivered.size > 0)
      // Повторная выдача: те же языки, что покупатель уже выбирал, без переспроса.
      result = await sendLangs(langs.filter((l) => delivered.has(l)));
    else if (langs.length > 1 && opts.ask)
      result = (await opts.ask(item, langs)) ? "pending" : "failed";
    else if (langs.length > 1 && opts.allWhenAmbiguous) result = await sendLangs(langs);
    else {
      const l = opts.lang && langs.includes(opts.lang) ? opts.lang : langs[0]!;
      result = await sendLangs([l]);
    }
    if (result === "sent") sent++;
    else if (result === "pending") {
      pending++;
      await recordOrderEvent(ctx, orderId, "item_pending", { name: item.name_snapshot });
    } else {
      failed++;
      if (langs.length === 0)
        await recordOrderEvent(ctx, orderId, "item_failed", {
          name: item.name_snapshot,
          reason: "у товара нет файлов или ссылок",
        });
    }
    const progress = await ctx.db
      .from("orders")
      .update({ delivery_index: i + 1 })
      .eq("id", orderId);
    // Ход выдачи не записан — дальше не шлём, иначе повтор отправит позицию второй раз.
    if (progress.error)
      await abortDelivery(
        ctx,
        order,
        Math.max(1, failed + (items.length - i - 1)),
        items.length,
        progress.error.message,
      );
  }
  if (pending > 0 && failed === 0)
    return { ok: true, sent, failed, pending, pointsEarned: 0, referral: null };
  const fin = await finalizeDelivery(ctx, order, failed, items.length);
  return { ok: true, sent, failed, pending, ...fin };
}

export type LanguagePickResult =
  | { status: "not_found" | "already" | "no_materials" | "failed" }
  | {
      status: "sent";
      /** Все позиции выданы — заказ закрыт. */
      completed: boolean;
      pointsEarned: number;
      referral: ReferralGrant | null;
    };

/** Заказ, по которому покупатель может выбрать язык файла: оплачен и выдаётся. */
export const LANGUAGE_PICK_STATUSES = ["paid", "delivering", "delivered"] as const;

/**
 * Покупатель ответил на вопрос о языке позиции: выдать её на этом языке и,
 * если ни одна позиция больше не ждёт выбора, закрыть заказ.
 */
export async function completeLanguageDelivery(
  ctx: TenantContext,
  p: { orderId: number; itemId: string; lang: Locale; telegramId: number },
  send: MaterialSender,
): Promise<LanguagePickResult> {
  const order = await getOrder(ctx, p.orderId);
  if (!order || order.telegram_id !== p.telegramId) return { status: "not_found" };
  // Кнопку языка можно подделать: файлы — только по оплаченному заказу в выдаче.
  if (!(LANGUAGE_PICK_STATUSES as readonly string[]).includes(order.status))
    return { status: "not_found" };
  const item = order.order_items.find((i) => i.id === p.itemId);
  if (!item) return { status: "not_found" };
  const delivered = parseDeliveredLanguages(item.delivered_language);
  if (delivered.has(p.lang)) return { status: "already" };
  // Оплачен один язык: после первого выбора другие — только за «все языки».
  if (delivered.size > 0 && order.delivery_lang_choice !== "all") return { status: "already" };
  const materials = itemMaterials(item, p.lang);
  if (materials.length === 0) return { status: "no_materials" };
  const course = item.delivered_language ? [] : await courseLink(ctx, item);
  const payload = [...(await protectMaterials(ctx, order, materials)), ...course];
  const r = payload.length ? await send(item, payload) : "failed";
  if (r !== "sent") {
    await recordOrderEvent(ctx, p.orderId, "item_failed", {
      name: item.name_snapshot,
      lang: p.lang,
      reason: "канал не доставил файл",
    });
    return { status: "failed" };
  }
  await markDelivered(ctx, item, item.delivered_language, p.lang);
  await recordOrderEvent(ctx, p.orderId, "item_sent", { name: item.name_snapshot, lang: p.lang });
  const multi = ctx.tenant.modules.multi_language;
  const stillPending = order.order_items.some((it) =>
    itemNeedsLanguageChoice(
      it.id === item.id
        ? { ...it, delivered_language: addDeliveredLanguage(item.delivered_language, p.lang) }
        : it,
      multi,
    ),
  );
  if (stillPending || order.status !== "delivering")
    return { status: "sent", completed: false, pointsEarned: 0, referral: null };
  const fin = await finalizeDelivery(ctx, order, 0, order.order_items.length);
  return { status: "sent", completed: true, ...fin };
}

/**
 * Подписанная ссылка на файл товара. `downloadName` — имя, под которым файл
 * скачается (materialDownloadName): с ним хранилище отдаёт вложение
 * «Пазлы БУКВЫ.pdf», а не страницу с ключом «1782643012614-ni1xub.pdf».
 */
export async function signedFileUrl(
  path: string,
  ttlSec = 7 * 24 * 3600,
  downloadName?: string,
): Promise<string | null> {
  if (!isSafeStorageKey(path)) return null;
  const { data, error } = await serviceDb()
    .storage.from("product-files")
    .createSignedUrl(path, ttlSec);
  if (error || !data?.signedUrl) return null;
  return downloadName ? withDownloadName(data.signedUrl, downloadName) : data.signedUrl;
}

/**
 * Почта покупателя в заказ (Instagram/WhatsApp, выдача письмом). Ошибку
 * базы не глотаем: иначе покупатель услышит «записал», а письмо не уйдёт.
 * Чужой или удалённый заказ — false, не ошибка.
 */
export async function setOrderEmail(
  ctx: TenantContext,
  orderId: number,
  telegramId: number,
  email: string,
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("orders")
    .update({ customer_email: email })
    .eq("id", orderId)
    .eq("telegram_id", telegramId)
    .select("id");
  if (error)
    throw serverFailure(`Не удалось сохранить почту в заказе #${orderId}: ${error.message}`);
  return (data ?? []).length > 0;
}
