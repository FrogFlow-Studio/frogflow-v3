import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { storefrontT } from "@/app/i18n/storefront";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { isLocale } from "@/core/i18n/locale";

/**
 * Страницы магазина нет (пустая «О магазине», выключенный квиз, снятый товар),
 * а сам магазин работает: шапка и корзина остаются, покупатель идёт в каталог.
 */
export function StorePageMissing() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const { t } = useStorefrontLocale();
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">{t("missing.page.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("missing.page.text")}</p>
      {slug && (
        <Link to="/s/$slug" params={{ slug }} className="btn-primary mt-6 inline-block">
          {t("cart.toCatalog")}
        </Link>
      )}
    </div>
  );
}

/** Магазина по адресу нет: язык из `?lang=`, иначе русский. */
export function StoreMissing() {
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const lang = new URLSearchParams(search).get("lang");
  const t = storefrontT(isLocale(lang) ? lang : "ru");
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-lg font-semibold">{t("missing.shop.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("missing.shop.text")}</p>
    </main>
  );
}
