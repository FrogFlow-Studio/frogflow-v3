import { adminT } from "@/app/i18n/admin";

/** Адрес витрины, как её видит покупатель; у клиента без витрины адреса нет — кнопки тоже. */
export function asBuyerHref(slug: string | null | undefined): string | null {
  return slug ? `/s/${encodeURIComponent(slug)}` : null;
}

/** «Моя витрина как покупатель» (П5): из «О магазине» и из настроек площадки. */
export function AsBuyerButton({
  slug,
  locale,
}: {
  slug: string | null | undefined;
  locale: Parameters<typeof adminT>[0];
}) {
  const href = asBuyerHref(slug);
  if (!href) return null;
  const t = adminT(locale);
  return (
    <div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="btn-secondary inline-flex"
        data-testid="as-buyer"
      >
        {t("settings.asBuyer")}
      </a>
      <p className="mt-1 text-xs text-muted">{t("settings.asBuyer.hint")}</p>
    </div>
  );
}
