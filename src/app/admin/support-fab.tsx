import { Link, useRouterState } from "@tanstack/react-router";
import type { AdminT } from "@/app/i18n/admin";

/**
 * Кнопка «Написать в поддержку» в углу каждой страницы админки. Ведёт в чат
 * и передаёт путь страницы: поддержка увидит, где продавец застрял. На самой
 * странице поддержки её нет.
 */
export function SupportFab({ t, enabled }: { t: AdminT; enabled: boolean }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (!enabled || path.startsWith("/admin/support")) return null;
  return (
    <Link
      to="/admin/support"
      search={{ from: path }}
      aria-label={t("help.writeUs")}
      title={t("help.writeUs")}
      className="fixed bottom-20 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-lg text-white shadow-lg md:bottom-6"
    >
      💬
    </Link>
  );
}
