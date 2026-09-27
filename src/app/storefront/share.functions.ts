import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { SHOP_SLUG_RE } from "@/core/tenant/slug";

const slug = z.string().regex(SHOP_SLUG_RE);

/**
 * Данные для превью ссылки на витрину (core/storefront/share): адрес, от
 * которого строятся абсолютные ссылки, и картинка магазина. Отдельно от
 * storefront.functions, чтобы не трогать код оформления заказа.
 */
export const storeShareFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ slug }).parse(d))
  .handler(async ({ data }) => {
    const { shareInfo } = await import("./share.server");
    const info = await shareInfo(data.slug.toLowerCase());
    if (!info) throw notFound();
    return info;
  });
