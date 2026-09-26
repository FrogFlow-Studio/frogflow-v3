import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isLocale, type Locale } from "@/core/i18n/locale";
import { storefrontT, type StorefrontT } from "@/app/i18n/storefront";

/**
 * Язык витрины. Сервер рисует язык магазина (`storeInfoFn().locale`), а в
 * браузере покупатель может переключить его через `?lang=kk` — выбор
 * запоминается в localStorage по магазину и применяется после гидратации,
 * чтобы SSR и первый рендер клиента совпадали.
 */
type LocaleApi = { locale: Locale; t: StorefrontT };

const Ctx = createContext<LocaleApi | null>(null);

export function StorefrontLocaleProvider({
  slug,
  initial,
  children,
}: {
  slug: string;
  initial: Locale;
  children: ReactNode;
}) {
  const key = `ff-lang-${slug}`;
  const [locale, setLocale] = useState<Locale>(initial);
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("lang");
      if (isLocale(fromUrl)) {
        localStorage.setItem(key, fromUrl);
        setLocale(fromUrl);
        return;
      }
      const saved = localStorage.getItem(key);
      if (isLocale(saved)) setLocale(saved);
    } catch {
      /* приватный режим — язык магазина */
    }
  }, [key]);
  // Язык страницы — для чтения с экрана и текста ошибок (ui/ErrorBox).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const api = useMemo<LocaleApi>(() => ({ locale, t: storefrontT(locale) }), [locale]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStorefrontLocale(): LocaleApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStorefrontLocale вне StorefrontLocaleProvider");
  return c;
}
