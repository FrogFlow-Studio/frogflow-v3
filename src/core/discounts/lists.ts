import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";

/*
 * Промокоды и сертификаты для админки — целиком, новые сверху, постранично
 * (PostgREST молча обрезает ответ на 1000). Второй ключ сортировки — id:
 * у пачки, созданной одним запросом, время создания совпадает.
 */

async function orFailure<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    throw serverFailure(e instanceof Error ? e.message : String(e));
  }
}

export const listPromoCodes = (ctx: TenantContext) =>
  orFailure(() =>
    pageAll(
      (from, to) =>
        ctx.db
          .from("promo_codes")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "промокоды",
    ),
  );

export const listGiftCertificates = (ctx: TenantContext) =>
  orFailure(() =>
    pageAll(
      (from, to) =>
        ctx.db
          .from("gift_certificates")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "сертификаты",
    ),
  );
