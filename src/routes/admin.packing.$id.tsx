import { createFileRoute, Link } from "@tanstack/react-router";
import { adminShopFn } from "@/app/admin/admin.functions";
import { packingSlipFn } from "@/app/admin/bundle.functions";
import { PackingSheet } from "@/app/admin/packing-view";
import { adminT, intlLocale } from "@/app/i18n/admin";

/**
 * Упаковочный лист (Н7): страница вне оболочки админки, чтобы в печать шло
 * только лист. Цен на странице нет: сервер их не отдаёт.
 */
export const Route = createFileRoute("/admin/packing/$id")({
  loader: async ({ params }) => {
    const [shop, data] = await Promise.all([
      adminShopFn(),
      packingSlipFn({ data: { id: Number(params.id) } }).catch(() => null),
    ]);
    return { shop, data };
  },
  component: PackingPage,
});

function PackingPage() {
  const { shop, data } = Route.useLoaderData();
  if (!shop || !data)
    return (
      <p className="p-6">
        <Link to="/admin/login">Войдите в панель магазина</Link>
      </p>
    );
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const s = data.slip;
  return (
    <main className="bg-white p-6 text-black">
      <style>{`@media print { .no-print { display: none !important; } @page { size: A4; margin: 12mm; } main { padding: 0 !important; } }`}</style>
      <div className="no-print mb-6 flex gap-2">
        <button className="btn-primary" onClick={() => window.print()}>
          {t("packing.print")}
        </button>
        <Link to="/admin/orders" className="btn-ghost">
          {t("packing.back")}
        </Link>
        <p className="self-center text-xs text-gray-500">{t("packing.note")}</p>
      </div>
      <PackingSheet slip={s} shopName={shop.name} t={t} loc={loc} />
    </main>
  );
}
