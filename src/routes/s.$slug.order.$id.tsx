import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { webOrderFn, webProofFn } from "@/app/storefront/checkout.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { formatMoney } from "@/core/money/money";
import { ErrorBox, useAction } from "@/app/ui";
import type { StorefrontKey } from "@/app/i18n/storefront";

export const Route = createFileRoute("/s/$slug/order/$id")({
  validateSearch: (s: Record<string, unknown>): { t: string } => ({
    t: typeof s.t === "string" ? s.t.slice(0, 64) : "",
  }),
  component: OrderPage,
});

type View = Awaited<ReturnType<typeof webOrderFn>>;

const PROOF_NOTE: Record<string, StorefrontKey> = {
  retry: "checkout.proof.retry",
  paymentFailed: "checkout.proof.paymentFailed",
  review: "checkout.proof.review",
  delivered: "checkout.proof.delivered",
};

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Страница заказа с сайта: открывается по подписанной ссылке из оформления и письма. */
function OrderPage() {
  const { slug, id } = Route.useParams();
  const { t: token } = Route.useSearch();
  const { t } = useStorefrontLocale();
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [note, setNote] = useState<StorefrontKey | null>(null);
  const ref = { slug, id: Number(id), t: token };
  const load = useCallback(() => {
    webOrderFn({ data: { slug, id: Number(id), t: token } })
      .then(setView)
      .catch(setLoadError);
  }, [slug, id, token]);
  useEffect(load, [load]);
  const proof = useAction(async (file: File) => {
    const r = await webProofFn({
      data: { ...ref, mime: file.type || "application/octet-stream", data: await toBase64(file) },
    });
    if (r.ok)
      setNote(
        PROOF_NOTE[r.result === "retry" && r.paymentFailed ? "paymentFailed" : r.result] ?? null,
      );
    load();
  });
  if (loadError) return <ErrorBox error={loadError} />;
  if (!view) return <p className="text-sm text-muted">…</p>;
  const awaiting = view.status === "awaiting_payment";
  const checking = view.status === "awaiting_confirmation";
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{t("order.title", { no: view.no })}</h1>
        <p className="mt-1 text-sm text-muted">
          {t(`orders.status.${view.status}` as StorefrontKey)}
        </p>
        <p className="mt-2 text-xs text-muted">{t("order.saveLink")}</p>
      </div>
      <ul className="divide-y divide-line text-sm">
        {view.items.map((i, n) => (
          <li key={n} className="flex justify-between gap-3 py-2">
            <span className="truncate">
              {i.name}
              {i.qty > 1 ? ` × ${i.qty}` : ""}
            </span>
            <span className="tabular-nums">{formatMoney(i.price * i.qty, view.currency)}</span>
          </li>
        ))}
      </ul>
      {note && <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">{t(note)}</p>}
      {awaiting && view.payment && (
        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">{t("order.pay")}</h2>
          <p className="text-lg font-semibold tabular-nums">
            {t("order.amount", { sum: formatMoney(view.total, view.currency) })}
          </p>
          {view.payment.instructions && (
            <p className="text-sm whitespace-pre-line">{view.payment.instructions}</p>
          )}
          {view.payment.qr && (
            <img src={view.payment.qr} alt="QR" className="h-48 w-48 rounded object-contain" />
          )}
          <div>
            <h3 className="text-sm font-medium">{t("order.proofTitle")}</h3>
            <p className="text-xs text-muted">{t("order.proofHint")}</p>
            <input
              type="file"
              accept="image/*,application/pdf"
              className="mt-2 block text-sm"
              disabled={proof.busy}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const f = e.currentTarget.files?.[0];
                if (f) void proof.run(f).catch(() => {});
                e.currentTarget.value = "";
              }}
            />
            <ErrorBox error={proof.error} />
          </div>
        </section>
      )}
      {checking && !note && (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">{t("order.waiting")}</p>
      )}
      {view.materials.length > 0 && (
        <section className="card space-y-2 p-5">
          <h2 className="font-semibold">{t("order.materials")}</h2>
          <ul className="space-y-1 text-sm">
            {view.materials.map((m, n) => (
              <li key={n}>
                <a
                  href={m.url}
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {m.name}
                </a>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{t("order.linkHint")}</p>
        </section>
      )}
    </div>
  );
}
