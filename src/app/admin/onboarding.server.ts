/**
 * «Пробный заказ» продавца (Р4, core/orders/trial): проверка оформления без
 * заказа в базе. Читает товар, считает цену так же, как корзина, собирает
 * факты (бот, оплата, файл, выдача, получатели) и присылает пробное
 * уведомление. Пробное уведомление уходит не чаще раза в минуту: условная
 * запись метки до отправки, и только выигравший шлёт; отправку, которая могла
 * дойти (обрыв, тайм-аут), не повторяем.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { getSettingsStrict, setSetting, updateSettingAtomic } from "@/core/settings/settings";
import { trialIssues, trialPassed, type TrialResult } from "@/core/orders/trial";
import { firstWeekState, type FirstWeekState } from "@/core/launch/first-week";
import { sellsInBot } from "@/core/tenant/preflight";
import { adminTFor } from "./locale.server";

export const TRIAL_STAMP_KEY = "trial_order_stamp";
/** Когда пробный заказ в последний раз прошёл целиком: по этой метке закрывается шаг чек-листа (Р3). */
export const TRIAL_DONE_KEY = "trial_order_done_at";
const MIN_GAP_MS = 60_000;

/** Первый включённый товар: на нём и идёт пробный заказ, если продавец не выбрал другой. */
async function firstActiveProductId(ctx: TenantContext): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("products")
    .select("id")
    .eq("is_active", true)
    .order("created_at")
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error) throw serverFailure(`Пробный заказ: ${error.message}`);
  return data?.id ?? null;
}

export async function runTrialOrder(
  ctx: TenantContext,
  productId: string | null,
  now = Date.now(),
): Promise<TrialResult> {
  const id = productId ?? (await firstActiveProductId(ctx));
  const empty = {
    ok: false,
    product: null,
    total: 0,
    dueNow: 0,
    currency: "KZT",
    issues: [],
    notified: "none" as const,
    noProduct: true,
  } satisfies TrialResult;
  if (!id) return empty;
  const { getProductForAdmin } = await import("@/core/catalog/admin");
  const product = await getProductForAdmin(ctx, id);
  if (!product) return empty;

  const { priceCart } = await import("@/core/cart/cart");
  const priced = await priceCart(
    ctx,
    [
      {
        id: "trial",
        quantity: 1,
        product_variant_id: null,
        products: product,
        product_variants: null,
      },
    ],
    null,
  );
  const { amountDueNow, fulfillmentSettings } = await import("@/core/fulfillment/fulfillment");
  const ful = await fulfillmentSettings(ctx);
  const dueNow = await amountDueNow(ctx, { total: priced.total, fulfillment_kind: priced.kind });
  const { listPaymentMethods } = await import("@/core/settings/payment-methods");
  const methods = await listPaymentMethods(ctx);
  const { productSellable } = await import("@/core/catalog/materials");
  const { adminRecipients } = await import("@/core/notify/recipients");
  const recipients = await adminRecipients(ctx);
  const issues = trialIssues({
    telegram: Boolean(ctx.tenant.telegramTokenEnc && ctx.tenant.settings.telegram?.username),
    paymentMethods: methods.length > 0 || Boolean(ctx.tenant.modules.robokassa),
    sellable: productSellable(product),
    physical: product.fulfillment_kind === "physical",
    pickup: ful.pickup,
    delivery: ful.delivery,
    recipients: recipients.length,
    total: priced.total,
    mixedCurrency: priced.mixedCurrency,
  });
  const ok = trialPassed(issues);

  const notified = await sendTrialNotice(ctx, product.name, priced.total, priced.currency, now);
  if (ok) await setSetting(ctx, TRIAL_DONE_KEY, new Date(now).toISOString());
  return {
    ok,
    product: { id: product.id, name: product.name },
    total: priced.total,
    dueNow,
    currency: priced.currency,
    issues,
    notified,
    noProduct: false,
  };
}

async function sendTrialNotice(
  ctx: TenantContext,
  name: string,
  total: number,
  currency: string,
  now: number,
): Promise<TrialResult["notified"]> {
  const { adminRecipients } = await import("@/core/notify/recipients");
  if (!ctx.tenant.telegramTokenEnc || (await adminRecipients(ctx)).length === 0) return "none";
  // Метка до отправки: двойной клик или две вкладки шлют одно сообщение.
  const claim = await updateSettingAtomic(ctx, TRIAL_STAMP_KEY, (raw) =>
    raw && now - Date.parse(raw) < MIN_GAP_MS ? null : new Date(now).toISOString(),
  );
  if (claim === "skipped") return "recent";
  if (claim === "failed") throw serverFailure("Пробный заказ: не удалось поставить метку");
  const t = await adminTFor(ctx);
  const { escapeHtml } = await import("@/channels/telegram/copy");
  const { formatMoney } = await import("@/core/money/money");
  const { notifyAdminsHtml } = await import("@/channels/telegram/notify");
  try {
    const sent = await notifyAdminsHtml(
      ctx,
      t("trial.notice", { name: escapeHtml(name), total: formatMoney(total, currency) }),
      { kind: "system" },
    );
    return sent > 0 ? "sent" : "none";
  } catch (e) {
    // Могло дойти — не повторяем и не шлём другим способом.
    console.error(`[trial:${ctx.tenant.id}] пробное уведомление: ${String(e)}`);
    return "failed";
  }
}

export async function trialDoneAt(ctx: TenantContext): Promise<string | null> {
  const s = await getSettingsStrict(ctx, [TRIAL_DONE_KEY]);
  return s[TRIAL_DONE_KEY] || null;
}

/**
 * Факты для «Первых 7 дней» (core/launch/first-week). Любое непрочитанное
 * число — ошибка, а не «ноль»: иначе упавшее чтение показало бы продавцу, что
 * у него нет товаров и оплаты. Вызывающий превращает ошибку в «карточку не
 * показываем».
 */
export async function loadFirstWeek(ctx: TenantContext): Promise<FirstWeekState> {
  const count = async (
    what: string,
    q: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  ) => {
    const { count: n, error } = await q;
    if (error) throw serverFailure(`Первые 7 дней, ${what}: ${error.message}`);
    return n ?? 0;
  };
  const { adminRecipients } = await import("@/core/notify/recipients");
  const sellers = (await adminRecipients(ctx)).map(Number).filter((n) => Number.isSafeInteger(n));
  const [activeProducts, methods, buyers, sellerRows, paidOrders, done] = await Promise.all([
    count(
      "товары",
      ctx.db.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
    ),
    count("оплата", ctx.db.from("payment_methods").select("id", { count: "exact", head: true })),
    count(
      "покупатели",
      ctx.db.from("bot_users").select("user_key", { count: "exact", head: true }),
    ),
    sellers.length
      ? count(
          "продавец среди покупателей",
          ctx.db
            .from("bot_users")
            .select("user_key", { count: "exact", head: true })
            .in("telegram_id", sellers),
        )
      : Promise.resolve(0),
    count(
      "оплаченные заказы",
      ctx.db.from("orders").select("id", { count: "exact", head: true }).gt("paid_amount", 0),
    ),
    trialDoneAt(ctx),
  ]);
  return firstWeekState({
    activeProducts,
    paymentReady: methods > 0 || Boolean(ctx.tenant.modules.robokassa),
    buyersBesideSeller: Math.max(0, buyers - sellerRows),
    trialPassed: Boolean(done),
    paidOrders,
    sells: sellsInBot(ctx.tenant, activeProducts),
  });
}
