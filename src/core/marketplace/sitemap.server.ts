import { serviceDb, type Db } from "@/core/db/client.server";
import { eachPage } from "@/core/db/page";
import { sitemapXml, type SitemapEntry } from "@/core/storefront/sitemap";
import { isMissingTable } from "./not-ready";

/**
 * Карта сайта площадки (Л4): авторы и их товары. Попадают только магазины, которым сейчас
 * вправе показываться на площадке (согласны, одобрены, не скрыты, на v2, с адресом), и только
 * товары из снимка `marketplace_items` (то, что можно купить сейчас). Скрытый автор, скрытый
 * или закончившийся товар и клиент прежней платформы в карту не идут. Читается постранично,
 * магазины куском по 200; адресов не больше SITEMAP_MARKET_MAX (протокол разрешает 50 000).
 */
export const SITEMAP_MARKET_MAX = 45_000;
const CHUNK = 200;

type Shop = { slug: string; name: string };

export async function marketSitemap(
  shops: Map<string, Shop>,
  base: string,
  svc: Db = serviceDb(),
): Promise<SitemapEntry[]> {
  const out: SitemapEntry[] = [];
  for (const s of shops.values()) out.push({ loc: `${base}/s/${s.slug}`, priority: 0.7 });
  const ids = [...shops.keys()];
  for (let i = 0; i < ids.length && out.length < SITEMAP_MARKET_MAX; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    try {
      await eachPage<{ bot_id: string; product_id: string }>(
        (from, to) =>
          svc
            .from("marketplace_items")
            .select("bot_id, product_id")
            .in("bot_id", chunk.slice(0, CHUNK))
            .order("bot_id")
            .order("product_id")
            .range(from, to),
        "площадка, карта сайта: товары не прочитаны",
        (rows) => {
          for (const r of rows) {
            const shop = shops.get(r.bot_id);
            if (shop && out.length < SITEMAP_MARKET_MAX)
              out.push({ loc: `${base}/s/${shop.slug}/p/${r.product_id}`, priority: 0.5 });
          }
          return out.length < SITEMAP_MARKET_MAX;
        },
      );
    } catch (e) {
      // Снимка ещё нет — в карте только авторы; любой другой сбой — ошибка, а не «товаров нет».
      if (isMissingTable({ message: e instanceof Error ? e.message : String(e) })) break;
      throw e;
    }
  }
  return out;
}

/** Готовый ответ карты: XML. */
export async function marketSitemapXml(
  shops: Map<string, Shop>,
  base: string,
  svc: Db = serviceDb(),
): Promise<string> {
  return sitemapXml(await marketSitemap(shops, base, svc));
}
