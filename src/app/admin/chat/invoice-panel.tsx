import { useEffect, useState } from "react";
import { chatInvoiceFn, invoiceCartFn, invoiceProductsFn } from "@/app/admin/chat.functions";
import { type AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";

type InvoiceProduct = Awaited<ReturnType<typeof invoiceProductsFn>>[number];

type InvoiceLine = { product: InvoiceProduct; variantId: string | null; quantity: number };

/**
 * «Выставить счёт»: продавец собирает позиции, покупатель получает их одним
 * сообщением с кнопкой «Оформить заказ» (core/cart/seller-cart). Цены здесь —
 * базовые; итог по стране покупателя считает сервер и пишет в ответе. Товары
 * ищутся по названию: каталог крупного магазина целиком в форму не грузим.
 */
export function InvoicePanel({
  t,
  link,
  telegramId,
  onClose,
  onSent,
}: {
  t: AdminT;
  /** Instagram/WhatsApp без оформления в канале: счёт — ссылкой на страницу заказа на сайте. */
  link: boolean;
  telegramId: number;
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<InvoiceProduct[] | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [cartCount, setCartCount] = useState(0);
  const [append, setAppend] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const search = useAction(async (q: string) => setFound(await invoiceProductsFn({ data: { q } })));
  const loadCart = useAction(async () =>
    setCartCount((await invoiceCartFn({ data: { telegramId } })).count),
  );
  useEffect(() => {
    void loadCart.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramId]);
  useEffect(() => {
    const timer = setTimeout(() => void search.run(query).catch(() => {}), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const add = (p: InvoiceProduct) => {
    setLines((ls) => [...ls, { product: p, variantId: p.variants[0]?.id ?? null, quantity: 1 }]);
    setDone(null);
  };
  const patch = (i: number, v: Partial<InvoiceLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...v } : l)));
  const send = useAction(async () => {
    const r = await chatInvoiceFn({
      data: {
        telegramId,
        append,
        items: lines.map((l) => ({
          productId: l.product.id,
          variantId: l.variantId,
          quantity: l.quantity,
        })),
      },
    });
    const total = `${r.total.toLocaleString()} ${r.currency}`;
    setDone(
      r.orderNo != null
        ? t("chat.invoiceSentLink", { no: r.orderNo, total })
        : t("chat.invoiceSent", { total }),
    );
    setLines([]);
    await loadCart.run().catch(() => {});
    await onSent();
  });
  return (
    <div className="max-h-[50%] overflow-y-auto border-t border-line p-3">
      <ErrorBox error={search.error ?? loadCart.error ?? send.error} />
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("chat.invoice")}</p>
        <button type="button" className="btn-secondary text-xs" onClick={onClose}>
          {t("chat.invoiceClose")}
        </button>
      </div>
      <p className="mb-2 text-xs text-muted">
        {link ? t("chat.invoiceHintLink") : t("chat.invoiceHint")}
      </p>
      {cartCount > 0 && (
        <div className="mb-2 rounded-md bg-surface-2 p-2 text-xs">
          <p>
            {append
              ? t("chat.invoiceCartAppend", { n: cartCount })
              : t("chat.invoiceCartReplace", { n: cartCount })}
          </p>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={append} onChange={(e) => setAppend(e.target.checked)} />
            {t("chat.invoiceAppend")}
          </label>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const p = l.product;
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
              {p.variants.length > 0 && (
                <select
                  className="input h-8 w-auto py-0 text-xs"
                  aria-label={t("chat.invoiceVariant")}
                  value={l.variantId ?? ""}
                  onChange={(e) => patch(i, { variantId: e.target.value })}
                >
                  {p.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.price.toLocaleString()} {p.currency}
                    </option>
                  ))}
                </select>
              )}
              {p.physical ? (
                <input
                  type="number"
                  className="input h-8 w-20 py-0 text-xs"
                  aria-label={t("chat.invoiceQty")}
                  min={1}
                  max={99}
                  value={l.quantity}
                  onChange={(e) =>
                    patch(i, { quantity: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })
                  }
                />
              ) : (
                p.variants.length === 0 && (
                  <span className="text-xs text-muted">
                    {p.price.toLocaleString()} {p.currency}
                  </span>
                )
              )}
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                {t("chat.invoiceRemove")}
              </button>
            </div>
          );
        })}
        <input
          className="input h-8 py-0 text-xs"
          placeholder={t("chat.invoiceSearch")}
          aria-label={t("chat.invoiceSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {found && found.length === 0 && (
          <p className="text-xs text-muted">{t("chat.invoiceNothing")}</p>
        )}
        {found && found.length > 0 && (
          <div className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-line">
            {found.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex justify-between gap-2 border-b border-line px-2 py-1 text-left text-xs last:border-b-0 hover:bg-surface-2"
                onClick={() => add(p)}
              >
                <span className="truncate">+ {p.name}</span>
                {p.variants.length === 0 && (
                  <span className="shrink-0 text-muted">
                    {p.price.toLocaleString()} {p.currency}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{done}</span>
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={lines.length === 0 || send.busy}
          onClick={() => void send.run().catch(() => {})}
        >
          {t("chat.invoiceSend")}
        </button>
      </div>
    </div>
  );
}
