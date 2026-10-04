import { createFileRoute, Link } from "@tanstack/react-router";
import { adminShopFn } from "@/app/admin/admin.functions";
import { packingSlipFn } from "@/app/admin/bundle.functions";
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
      <section className="mx-auto max-w-2xl space-y-5 text-base">
        <header className="border-b border-black pb-3">
          <h1 className="text-2xl font-bold">{t("packing.title")}</h1>
          <p>
            {shop.name} · {t("packing.order", { no: String(s.orderNo) })}
          </p>
          {s.date && (
            <p>
              {t("packing.date")}: {new Date(s.date).toLocaleDateString(loc, { timeZone: "UTC" })}
              {s.fulfillmentType
                ? ` · ${s.fulfillmentType === "delivery" ? t("packing.delivery") : t("packing.pickup")}`
                : ""}
            </p>
          )}
        </header>
        {s.gift && (
          <div className="rounded border-2 border-black p-4">
            <p className="text-lg font-bold">🎁 {t("order.gift")}</p>
            {s.gift.recipient && (
              <p className="mt-2">
                {t("packing.for")}: <b>{s.gift.recipient}</b>
              </p>
            )}
            {s.gift.message && (
              <div className="mt-3">
                <p className="text-sm text-gray-600">{t("packing.card")}</p>
                <p className="whitespace-pre-wrap text-xl">{s.gift.message}</p>
              </div>
            )}
          </div>
        )}
        {s.wrap && <p className="text-lg font-semibold">🎁 {t("packing.wrap")}</p>}
        <ul className="space-y-3">
          {s.lines.map((l, i) => (
            <li key={i} className="border-b border-gray-300 pb-2">
              <p className="text-lg">
                <b>{l.qty} ×</b> {l.name}
              </p>
              {l.parts.length > 0 && (
                <div className="ml-6 mt-1 text-sm">
                  <p className="text-gray-600">{t("packing.parts")}:</p>
                  <ul className="list-disc pl-5">
                    {l.parts.map((p, j) => (
                      <li key={j}>
                        {p.qty} × {p.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
