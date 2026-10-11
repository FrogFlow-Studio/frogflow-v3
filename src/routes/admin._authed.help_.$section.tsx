import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { HelpView } from "@/app/admin/help-view";
import { adminT } from "@/app/i18n/admin";
import { HELP_GROUPS, type HelpGroup } from "@/core/help/articles";

export const Route = createFileRoute("/admin/_authed/help_/$section")({
  validateSearch: z.object({ q: z.string().max(200).optional(), a: z.string().max(80).optional() }),
  beforeLoad: ({ params }) => {
    if (!(HELP_GROUPS as readonly string[]).includes(params.section))
      throw redirect({ to: "/admin/help" });
  },
  component: HelpSectionPage,
});

/** Пункт меню «Помощь»: быстрый старт, справочник по разделам или «что делать, если». */
function HelpSectionPage() {
  const { shop } = Route.useRouteContext();
  const { section } = Route.useParams();
  const { q, a } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <HelpView
      t={adminT(shop.locale)}
      locale={shop.locale}
      group={section as HelpGroup}
      q={q}
      a={a}
      onQuery={(v) => void navigate({ search: { q: v }, replace: true })}
    />
  );
}
