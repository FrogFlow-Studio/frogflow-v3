import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
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

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
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
