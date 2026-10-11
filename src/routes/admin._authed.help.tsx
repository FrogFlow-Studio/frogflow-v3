import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { HelpView } from "@/app/admin/help-view";
import { adminT } from "@/app/i18n/admin";

export const Route = createFileRoute("/admin/_authed/help")({
  validateSearch: z.object({ q: z.string().max(200).optional(), a: z.string().max(80).optional() }),
  component: HelpPage,
});

/** Помощь: поиск по всем статьям на языке панели и сама статья. Статьи — docs/help, таблицы нет. */
function HelpPage() {
  const { shop } = Route.useRouteContext();
  const { q, a } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <HelpView
      t={adminT(shop.locale)}
      locale={shop.locale}
      q={q}
      a={a}
      onQuery={(v) => void navigate({ search: { q: v }, replace: true })}
    />
  );
}
