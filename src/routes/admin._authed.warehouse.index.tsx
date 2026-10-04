import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { adminT } from "@/app/i18n/admin";
import { Card, PageTitle } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/warehouse/")({
  beforeLoad: ({ context }) => {
    if (!context.shop.modules.warehouse) throw redirect({ to: "/admin" });
  },
  component: WarehouseHub,
});

function WarehouseHub() {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  return (
    <>
      <PageTitle title={t("warehouse.title")} subtitle={t("warehouse.subtitle")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/admin/warehouse/suppliers" className="block hover:opacity-90">
          <Card title={t("warehouse.hub.suppliers")}>
            <p className="text-sm text-muted">{t("warehouse.hub.suppliersHint")}</p>
          </Card>
        </Link>
      </div>
    </>
  );
}
