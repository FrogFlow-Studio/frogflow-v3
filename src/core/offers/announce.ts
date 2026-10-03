import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import { createBroadcast } from "@/core/broadcasts/broadcasts";
import { isLocale, type Locale } from "@/core/i18n/locale";
import { listOffers, updateOffers, type LimitedOffer } from "./offers";
import { announceText, type SaleInfo } from "./texts";

export const offerAnnouncedKey = (id: string) => `offer_announced:${id}`;

/** Названия и валюта для текста об акции: товар из каталога или категория. */
export async function saleInfoOf(ctx: TenantContext, o: LimitedOffer): Promise<SaleInfo> {
  let what = "";
  let currency = "KZT";
  if (o.category_id) {
    const { data, error } = await ctx.db
      .from("categories")
      .select("name")
      .eq("id", o.category_id)
      .maybeSingle();
    if (error) throw serverFailure(`Акция, категория: ${error.message}`);
    what = data?.name ? `«${data.name}»` : "";
  } else {
    const { data, error } = await ctx.db
      .from("products")
      .select("name, currency")
      .eq("id", o.product_id)
      .maybeSingle();
    if (error) throw serverFailure(`Акция, товар: ${error.message}`);
    what = data?.name ?? "";
    currency = String(data?.currency || "KZT").toUpperCase();
  }
  return {
    what: o.title?.trim() || what,
    percent: o.percent,
    newPrice: o.new_price ?? null,
    currency,
    endsAt: o.ends_at,
    tz: ctx.timezone,
  };
}

/**
 * «Позвать покупателей»: рассылка в Telegram всем, кто не отписался, с
 * товаром под сообщением (у акции на категорию — кнопка каталога). Один раз
 * на акцию: метка в app_settings ставится вставкой до рассылки (повтор
 * ключа — второй клик или вторая вкладка проигрывает) и снимается, если
 * рассылку создать не удалось. По этой рассылке потом уходит напоминание.
 */
export async function announceOffer(
  ctx: TenantContext,
  id: string,
  now = new Date(),
): Promise<{ recipients: number }> {
  if (!ctx.tenant.modules.broadcasts || !ctx.tenant.telegramTokenEnc)
    throw new UserError(
      "err.admin.offerAnnounceModule",
      "Рассылка недоступна: нужен модуль «Рассылки» и подключённый Telegram-бот.",
    );
  const offer = (await listOffers(ctx)).find((o) => o.id === id);
  if (!offer) throw new UserError("err.admin.offerGone", "Акция не найдена.");
  if (Date.parse(offer.ends_at) <= now.getTime())
    throw new UserError("err.admin.offerAnnounceEnded", "Акция уже закончилась.");
  if (offer.announced_at)
    throw new UserError(
      "err.admin.offerAnnounced",
      "Покупателей уже звали на эту акцию — повторная рассылка не отправляется.",
    );

  const mark = await ctx.db
    .from("app_settings")
    .insert({ bot_id: ctx.tenant.id, key: offerAnnouncedKey(id), value: now.toISOString() });
  if (mark.error) {
    if (mark.error.code === "23505")
      throw new UserError(
        "err.admin.offerAnnounced",
        "Покупателей уже звали на эту акцию — повторная рассылка не отправляется.",
      );
    throw serverFailure(`Акция, отметка рассылки: ${mark.error.message}`);
  }
  const release = () =>
    ctx.db
      .from("app_settings")
      .delete()
      .eq("bot_id", ctx.tenant.id)
      .eq("key", offerAnnouncedKey(id));

  const locale: Locale = isLocale(ctx.tenant.settings.default_locale)
    ? ctx.tenant.settings.default_locale
    : "ru";
  const info = await saleInfoOf(ctx, offer);
  const r = await createBroadcast(ctx, {
    text: announceText(info, locale),
    photoKeys: [],
    productIds: offer.category_id ? [] : [offer.product_id],
    showCatalog: Boolean(offer.category_id),
    audience: "all",
  });
  if (!r.ok) {
    await release();
    throw r.reason === "busy"
      ? new UserError(
          "err.admin.offerAnnounceBusy",
          "Уже идёт другая рассылка — дождитесь её и нажмите снова.",
        )
      : r.reason === "no_recipients"
        ? new UserError("err.admin.offerAnnounceNone", "Некому писать: в боте нет покупателей.")
        : serverFailure(`Акция, рассылка: ${r.message}`);
  }
  await updateOffers(ctx, (all) =>
    all.map((o) =>
      o.id === id ? { ...o, broadcast_id: r.broadcast.id, announced_at: now.toISOString() } : o,
    ),
  );
  return { recipients: r.broadcast.total_count };
}
