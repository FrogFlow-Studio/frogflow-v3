import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { isLocale } from "@/core/i18n/locale";
import type { ReactNode } from "react";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "FrogFlow" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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
