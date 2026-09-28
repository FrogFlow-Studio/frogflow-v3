import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { adminShopFn, orderFn } from "@/app/admin/admin.functions";
import { adminT, intlLocale } from "@/app/i18n/admin";
import { formatMoney } from "@/core/money/money";
import { displayNo } from "@/core/orders/pure";
import { slotOf } from "@/core/fulfillment/slots";

/**
 * Печать заказа одной кнопкой: бланк (A4) и наклейка на коробку (58×40 мм).
 * Страница вне оболочки админки, чтобы в печать шло только нужное; доступ
 * проверяют серверные функции (orderFn — любая роль панели, как карточка).
 */
export const Route = createFileRoute("/admin/print/$id")({
  loader: async ({ params }) => {
    const [shop, data] = await Promise.all([
      adminShopFn(),
      orderFn({ data: { id: Number(params.id) } }).catch(() => null),
    ]);
    return { shop, data };
  },
  component: PrintPage,
});

function PrintPage() {
  const { shop, data } = Route.useLoaderData();
  const [what, setWhat] = useState<"sheet" | "label">("sheet");
  if (!shop || !data)
    return (
      <p className="p-6">
        <Link to="/admin/login">Войдите в панель магазина</Link>
      </p>
    );
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const o = data.order;
  const no = displayNo(o);
  const physical = o.fulfillment_kind === "physical";
  const date = o.fulfillment_at
    ? `${new Date(o.fulfillment_at).toLocaleDateString(loc, { timeZone: "UTC" })}${
        slotOf(o.fulfillment_at, data.slots) ? `, ${slotOf(o.fulfillment_at, data.slots)}` : ""
      }`
    : null;
  const print = (w: "sheet" | "label") => {
    setWhat(w);
    setTimeout(() => window.print(), 50);
  };
  return (
    <main className="bg-white p-6 text-black">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-${what === "sheet" ? "label" : "sheet"} { display: none !important; }
          @page { size: ${what === "label" ? "58mm 40mm" : "A4"}; margin: ${what === "label" ? "2mm" : "12mm"}; }
          main { padding: 0 !important; }
        }
      `}</style>
      <div className="no-print mb-6 flex gap-2">
        <button className="btn-primary" onClick={() => print("sheet")}>
          {t("print.sheet")}
        </button>
        <button className="btn-secondary" onClick={() => print("label")}>
          {t("print.label")}
        </button>
        <Link to="/admin/orders/$id" params={{ id: String(o.id) }} className="btn-ghost">
          {t("print.back")}
        </Link>
      </div>

      <section className="print-sheet mx-auto max-w-2xl space-y-4 text-sm">
        <header className="flex items-start justify-between border-b border-black pb-3">
          <div>
            <h1 className="text-xl font-bold">{shop.name}</h1>
            <p>{t("order.title", { no })}</p>
          </div>
          <p className="text-right">{new Date(o.created_at).toLocaleString(loc)}</p>
        </header>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1">
          <dt>{t("order.name")}</dt>
          <dd>{o.display_name}</dd>
          <dt>{t("order.phone")}</dt>
          <dd>{o.contact ?? "—"}</dd>
          {physical && (
            <>
              <dt>{t("order.fulfillment")}</dt>
              <dd>
                {o.fulfillment_type === "delivery" ? t("order.delivery") : t("order.pickup")}
                {date ? ` · ${date}` : ""}
              </dd>
              {o.fulfillment_address && (
                <>
                  <dt>{t("physical.address")}</dt>
                  <dd>
                    {o.delivery_zone_name ? `${o.delivery_zone_name}, ` : ""}
                    {o.fulfillment_address}
                  </dd>
                </>
              )}
              {o.fulfillment_note && (
                <>
                  <dt>{t("physical.comment")}</dt>
                  <dd className="font-semibold">{o.fulfillment_note}</dd>
                </>
              )}
            </>
          )}
        </dl>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1">{t("order.items")}</th>
              <th className="py-1 text-right">{t("print.qty")}</th>
              <th className="py-1 text-right">{t("common.total")}</th>
            </tr>
          </thead>
          <tbody>
            {(o.order_items ?? []).map((i) => (
              <tr key={i.id} className="border-b border-gray-300">
                <td className="py-1">{i.name_snapshot}</td>
                <td className="py-1 text-right">{i.quantity}</td>
                <td className="py-1 text-right">
                  {formatMoney(Number(i.price_snapshot) * i.quantity, o.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-right text-base font-bold">
          {t("common.total")}: {formatMoney(o.total, o.currency)}
          {physical && Number(o.paid_amount) > 0 && Number(o.paid_amount) < Number(o.total) && (
            <span className="block text-sm font-normal">
              {t("physical.paid")} {formatMoney(o.paid_amount, o.currency)} ·{" "}
              {t("physical.remaining")}{" "}
              {formatMoney(Number(o.total) - Number(o.paid_amount), o.currency)}
            </span>
          )}
        </p>
        {o.admin_note && <p className="border-t border-black pt-2">{o.admin_note}</p>}
      </section>

      <section className="print-label mx-auto mt-10 w-[58mm] border border-dashed border-gray-400 p-2 text-[11px] leading-tight print:mt-0 print:border-0">
        <p className="text-base font-bold">#{no}</p>
        <p className="font-semibold">{o.display_name}</p>
        <p>{o.contact ?? ""}</p>
        {date && <p>{date}</p>}
        {o.fulfillment_address && <p className="line-clamp-2">{o.fulfillment_address}</p>}
        <p className="mt-1 line-clamp-2">
          {(o.order_items ?? []).map((i) => `${i.name_snapshot} ×${i.quantity}`).join(", ")}
        </p>
      </section>
    </main>
  );
}
