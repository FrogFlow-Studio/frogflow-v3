import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { adminShopFn } from "@/app/admin/admin.functions";
import { deliveryLabelsFn, packingBatchFn } from "@/app/admin/batch.functions";
import { PackingSheet } from "@/app/admin/packing-view";
import { adminErrorText } from "@/app/i18n/user-error";
import { adminT, intlLocale } from "@/app/i18n/admin";

/**
 * Печать пачкой (А16): упаковочные листы или этикетки доставки по выбранным
 * заказам (`ids`) либо по фильтру списка. Страница вне оболочки админки — в
 * печать идут только листы; каждый лист на своей странице.
 */
const search = z.object({
  kind: z.enum(["slips", "labels"]),
  ids: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
  pickup: z.enum(["today", "tomorrow", "overdue", "nodate"]).optional(),
  unpaid: z.boolean().optional(),
  assembly: z.literal("today").optional(),
});

export const Route = createFileRoute("/admin/print-batch")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const shop = await adminShopFn();
    if (!shop) return { shop, slips: null, labels: null, error: null };
    const { kind, ids, ...filter } = deps;
    const data = ids ? { ids: ids.split(",").map(Number).filter(Number.isInteger) } : { filter };
    try {
      return kind === "slips"
        ? { shop, slips: await packingBatchFn({ data }), labels: null, error: null }
        : { shop, slips: null, labels: await deliveryLabelsFn({ data }), error: null };
    } catch (e) {
      return { shop, slips: null, labels: null, error: adminErrorText(shop.locale, e) };
    }
  },
  component: PrintBatchPage,
});

function PrintBatchPage() {
  const { shop, slips, labels, error } = Route.useLoaderData();
  if (!shop)
    return (
      <p className="p-6">
        <Link to="/admin/login">Войдите в панель магазина</Link>
      </p>
    );
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const count = slips ? slips.slips.length : (labels?.labels.length ?? 0);
  return (
    <main className="bg-white p-6 text-black">
      <style>{`@media print { .no-print { display: none !important; } @page { size: A4; margin: 12mm; } main { padding: 0 !important; } .sheet { break-after: page; } .sheet:last-child { break-after: auto; } }`}</style>
      <div className="no-print mb-6 flex flex-wrap gap-2">
        {count > 0 && (
          <button className="btn-primary" onClick={() => window.print()}>
            {t("batch.print")} ({count})
          </button>
        )}
        <Link to="/admin/orders" className="btn-ghost">
          {t("packing.back")}
        </Link>
        <div className="self-center text-xs text-gray-500">
          {slips && <p>{t("packing.note")}</p>}
          {labels && <p>{t("batch.labelsNote")}</p>}
          {slips && slips.missing > 0 && <p>{t("batch.missing", { n: slips.missing })}</p>}
          {labels && labels.skipped > 0 && <p>{t("batch.labelsSkipped", { n: labels.skipped })}</p>}
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!error && count === 0 && <p>{t("batch.empty")}</p>}
      {slips?.slips.map((s) => (
        <div key={s.orderNo} className="sheet mb-10">
          <PackingSheet slip={s} shopName={shop.name} t={t} loc={loc} />
        </div>
      ))}
      {labels && (
        <div className="grid grid-cols-2 gap-3">
          {labels.labels.map((l) => (
            <section key={l.orderNo} className="break-inside-avoid border-2 border-black p-4">
              <p className="text-sm">
                {shop.name} · {t("packing.order", { no: String(l.orderNo) })}
                {l.date && ` · ${new Date(l.date).toLocaleDateString(loc, { timeZone: "UTC" })}`}
              </p>
              <p className="mt-2 text-lg font-bold">
                {t("batch.labelTo")}: {l.name}
              </p>
              {l.recipient && (
                <p>
                  🎁 {t("batch.labelGift")}: <b>{l.recipient}</b>
                </p>
              )}
              <p>
                {t("batch.labelPhone")}: {l.phone}
              </p>
              <p>
                {t("batch.labelAddress")}: {l.address}
              </p>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
