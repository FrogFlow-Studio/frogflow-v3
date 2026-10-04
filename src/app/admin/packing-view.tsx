import type { AdminT } from "@/app/i18n/admin";
import type { PackingSlip } from "@/core/orders/packing-slip";

/** Один упаковочный лист (Н7): без цен — их нет в данных. Общий для листа заказа и печати пачкой. */
export function PackingSheet({
  slip: s,
  shopName,
  t,
  loc,
}: {
  slip: PackingSlip;
  shopName: string;
  t: AdminT;
  loc: string;
}) {
  return (
    <section className="mx-auto max-w-2xl space-y-5 text-base">
      <header className="border-b border-black pb-3">
        <h1 className="text-2xl font-bold">{t("packing.title")}</h1>
        <p>
          {shopName} · {t("packing.order", { no: String(s.orderNo) })}
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
  );
}
