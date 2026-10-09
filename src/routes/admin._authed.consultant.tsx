import { createFileRoute } from "@tanstack/react-router";
import { consultantFn } from "@/app/admin/consultant-settings.functions";
import { consultantWorkspace } from "@/app/admin/nav-model";
import { pricelistFn } from "@/app/admin/pricelist.functions";
import { WorkspaceSettings } from "@/app/admin/consultant/workspace-settings";
import { ConsultantClassic } from "@/app/admin/consultant/classic";

export const Route = createFileRoute("/admin/_authed/consultant")({
  loader: async ({ context }) => {
    // Рабочее место консультанта без продаж: «Настройки бота» — ещё и карточки прайса
    // (часы менеджеров, бутик, образ).
    const [c, pl] = await Promise.all([
      consultantFn(),
      consultantWorkspace(context.shop) ? pricelistFn() : null,
    ]);
    return { ...c, pl };
  },
  component: ConsultantPage,
});

function ConsultantPage() {
  const data = Route.useLoaderData();
  if (data.pl) return <WorkspaceSettings />;
  return <ConsultantClassic />;
}
