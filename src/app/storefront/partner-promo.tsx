import { useEffect, useState } from "react";
import { partnerPromosFn } from "@/app/storefront/partner-promos.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { jointT } from "@/app/i18n/storefront-joint";
import { intlLocale } from "@/app/i18n/admin";

type Banner = Awaited<ReturnType<typeof partnerPromosFn>>["banners"][number];

/** «Акция партнёров»: рамка над каталогом, пока идёт совместная акция магазина. Сбой чтения — ничего. */
export function PartnerPromos({ slug }: { slug: string }) {
  const { locale } = useStorefrontLocale();
  const t = jointT(locale);
  const [banners, setBanners] = useState<Banner[]>([]);
  useEffect(() => {
    let live = true;
    partnerPromosFn({ data: { slug } }).then(
      (r) => live && setBanners(r.banners),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [slug]);
  if (banners.length === 0) return null;
  return (
    <div className="mb-4 space-y-3">
      {banners.map((b) => (
        <section key={`${b.title}|${b.endsAt}`} className="card p-4">
          <h2 className="font-semibold">
            {t("joint.title")}: {b.title}{" "}
            <span className="text-sm font-normal text-muted">
              {t("joint.until", {
                date: new Date(b.endsAt).toLocaleDateString(intlLocale(locale)),
              })}
            </span>
          </h2>
          <p className="mt-2 text-sm">
            {t("joint.here", { code: b.mine.code, percent: b.mine.percent })}
            {b.mine.conditions ? ` ${b.mine.conditions}` : ""}
          </p>
          {b.partners.map((p) => (
            <p key={p.name} className="mt-1 text-sm">
              {t("joint.there", { name: p.name, code: p.code, percent: p.percent })}
              {p.conditions ? ` ${p.conditions}` : ""}
              {p.slug && (
                <>
                  {" "}
                  <a href={`/s/${p.slug}`} className="underline">
                    {t("joint.open")}
                  </a>
                </>
              )}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
