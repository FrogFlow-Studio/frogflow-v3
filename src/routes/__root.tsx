import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { privateHeaders } from "@/app/cache-policy";
import { isLocale } from "@/core/i18n/locale";
import type { ReactNode } from "react";
import appCss from "../styles.css?url";

/**
 * Иконки платформы (public/): вкладка, поиск (Яндекс берёт 120+ px), экран телефона.
 * Витрина магазина и админка ставят свои манифест и иконки (core/storefront/share,
 * routes/admin): у них первыми должны стоять их ссылки, а лягушку витрине не показываем.
 */
const PLATFORM_ICON_LINKS = [
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
  { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
];
const OWN_ICONS = /^\/(s\/\$slug|admin)(\/|$)/;

export const Route = createRootRoute({
  // Без явной политики страница не кешируется (app/cache-policy); общие страницы её переопределяют.
  headers: privateHeaders,
  head: ({ matches }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "FrogFlow" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      ...(matches.some((m) => OWN_ICONS.test(m.routeId)) ? [] : PLATFORM_ICON_LINKS),
    ],
  }),
  shellComponent: Shell,
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-5xl font-bold">404</h1>
      <p className="mt-3 text-sm text-neutral-500">Такой страницы нет.</p>
    </main>
  ),
});

/**
 * Язык страницы уже в ответе сервера: поисковики читают `lang` до скриптов.
 * `?lang=` — только у главной и страниц ниш; остальные страницы ставят язык
 * сами в браузере (витрина, админка).
 */
function useServerLang(): string {
  return useRouterState({
    select: (s) => {
      const { pathname, search } = s.location;
      const lang = (search as { lang?: unknown }).lang;
      const landing = pathname === "/" || pathname.startsWith("/for/");
      return landing && isLocale(lang) ? lang : "ru";
    },
  });
}

function Shell({ children }: { children: ReactNode }) {
  const lang = useServerLang();
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
