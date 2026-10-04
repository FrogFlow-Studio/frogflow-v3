import { useEffect, useState } from "react";
import { recommendedShopsFn } from "@/app/community-author/author.functions";
import { authorT } from "@/app/community-author/i18n";
import { useStorefrontLocale } from "@/app/storefront/locale";

type Shop = Awaited<ReturnType<typeof recommendedShopsFn>>["shops"][number];

/** «Рекомендуем»: магазины, с которыми у этого взаимная рекомендация авторов. Сбой чтения — ничего. */
export function RecommendedShops({ slug }: { slug: string }) {
  const { locale } = useStorefrontLocale();
  const t = authorT(locale);
  const [shops, setShops] = useState<Shop[]>([]);
  useEffect(() => {
    let live = true;
    recommendedShopsFn({ data: { slug } }).then(
      (r) => live && setShops(r.shops),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [slug]);
  if (shops.length === 0) return null;
  return (
    <section className="mb-4" data-testid="recommended-shops">
      <h2 className="text-sm font-semibold">{t("recs.title")}</h2>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {shops.map((s) => (
          <li key={s.slug}>
            <a href={`/s/${s.slug}`} className="underline">
              {s.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
