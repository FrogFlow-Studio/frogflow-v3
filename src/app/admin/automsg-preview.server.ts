import type { TenantContext } from "@/core/tenant/resolve.server";
import { isLocale, type Locale } from "@/core/i18n/locale";
import { serverFailure } from "@/lib/server-failure";
import { formatMoney } from "@/core/money/money";
import { parseWinback, loadWinback, winbackText } from "@/core/winback/winback";
import { loadSimilar, parseSimilar, similarText } from "@/core/similar/similar";
import { buttonLabel } from "@/core/broadcasts/pure";
import { cartReminderBody, escapeHtml } from "@/channels/telegram/copy";
import { adminTelegramApi } from "@/channels/telegram/notify";
import { adminRecipients } from "@/core/notify/recipients";

/**
 * Предпросмотр автосообщений («Брошенная корзина», «Возврат клиентов»,
 * «Похожие материалы»): тот же текст, что уйдёт покупателю, — теми же
 * функциями (cartReminderBody, winbackText, similarText), на примере
 * последнего покупателя магазина и первых товаров каталога. Ни `state`
 * покупателей, ни потолок маркетинговых сообщений не затрагиваются.
 */
export type PreviewKind = "cart" | "winback" | "similar";

export type Preview = {
  /** Имя покупателя-образца; null — покупателей ещё нет, имя выдуманное. */
  buyer: string | null;
  /** Одно или два сообщения (у возврата — по шагу серии). */
  texts: string[];
  /** Кнопки под сообщением у покупателя (названия); продавцу уходят строками под текстом. */
  buttons: string[];
  locale: Locale;
};

const SAMPLE_NAME = "Анна";

async function sampleBuyer(ctx: TenantContext): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("bot_users")
    .select("user_key, first_name")
    .eq("platform", "telegram")
    .not("first_name", "is", null)
    .order("created_at", { ascending: false })
    .order("user_key")
    .limit(1);
  if (error) throw serverFailure(`Предпросмотр: ${error.message}`);
  const name = data?.[0]?.first_name?.trim();
  return name || null;
}

/** Первые товары каталога как образец состава корзины и кнопок. */
async function sampleProducts(ctx: TenantContext, n: number) {
  const { data, error } = await ctx.db
    .from("products")
    .select("id, name, price, currency")
    .eq("is_active", true)
    .order("sort_order")
    .order("id")
    .limit(n);
  if (error) throw serverFailure(`Предпросмотр: ${error.message}`);
  return data ?? [];
}

export async function buildPreview(
  ctx: TenantContext,
  kind: PreviewKind,
  draft?: unknown,
): Promise<Preview> {
  const configured = ctx.tenant.settings.default_locale;
  const locale: Locale = isLocale(configured) ? configured : "ru";
  const real = await sampleBuyer(ctx);
  const name = real ?? SAMPLE_NAME;
  if (kind === "winback") {
    const cfg = draft ? parseWinback(JSON.stringify(draft)) : await loadWinback(ctx);
    const texts = [winbackText(cfg, 1, name)];
    if (cfg.days2 != null) texts.push(winbackText(cfg, 2, name));
    return { buyer: real, texts, buttons: [], locale };
  }
  if (kind === "similar") {
    const cfg = draft ? parseSimilar(JSON.stringify(draft)) : await loadSimilar(ctx);
    const products = await sampleProducts(ctx, 3);
    return {
      buyer: real,
      texts: [similarText(cfg, name)],
      buttons: products.map((p) => `📖 ${buttonLabel(p.name)}`),
      locale,
    };
  }
  const products = await sampleProducts(ctx, 3);
  const lines = products.slice(0, 2).map((p, i) => ({ name: p.name, quantity: i === 0 ? 2 : 1 }));
  const sameCurrency =
    products.length > 0 && products.every((p) => p.currency === products[0]!.currency);
  const total = sameCurrency
    ? formatMoney(
        products.slice(0, 2).reduce((sum, p, i) => sum + Number(p.price) * (i === 0 ? 2 : 1), 0),
        products[0]!.currency,
      )
    : null;
  return {
    buyer: real,
    texts: [
      cartReminderBody(
        locale,
        lines.length ? lines : [{ name: "—", quantity: 1 }],
        Math.max(0, products.length - 2),
        total,
      ),
    ],
    buttons: [],
    locale,
  };
}

/**
 * «Отправить себе»: тот же текст — продавцам магазина в Telegram через бота
 * магазина, напрямую (без матрицы уведомлений и тихих часов, не в счёт
 * потолка). Возвращает, скольким ушло; без бота — 0.
 */
export async function sendPreviewToSeller(
  ctx: TenantContext,
  preview: Preview,
  header: string,
): Promise<number> {
  const api = adminTelegramApi(ctx);
  if (!api) return 0;
  const ids = await adminRecipients(ctx);
  let sent = 0;
  for (const id of ids) {
    for (const text of preview.texts) {
      const r = await api.call("sendMessage", {
        chat_id: id,
        text: `${escapeHtml(header)}\n\n${escapeHtml(text)}${
          preview.buttons.length ? `\n\n${escapeHtml(preview.buttons.join("\n"))}` : ""
        }`,
        parse_mode: "HTML",
      });
      if (r.ok) sent++;
    }
  }
  return sent;
}
