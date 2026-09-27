import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { webCardPayFn, webOrderFn, webProofFn } from "@/app/storefront/checkout.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { TgLoginBox, useTgLogin } from "@/app/storefront/tg-login";
import { formatMoney } from "@/core/money/money";
import { isoToDisplay } from "@/core/fulfillment/pure";
import { ErrorBox, useAction } from "@/app/ui";
import type { StorefrontKey } from "@/app/i18n/storefront";
import { rememberOrderToken, savedOrderToken } from "@/app/storefront/order-token";

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
  balance: "checkout.proof.balance",
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
  const { t: fromUrl } = Route.useSearch();
  const [token, setToken] = useState(fromUrl);
  const [noLink, setNoLink] = useState(false);
  useEffect(() => {
    if (fromUrl) rememberOrderToken(slug, id, fromUrl);
    else {
      const saved = savedOrderToken(slug, id);
      setToken(saved);
      setNoLink(!saved);
    }
  }, [slug, id, fromUrl]);
  const { t } = useStorefrontLocale();
  const login = useTgLogin(slug);
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [note, setNote] = useState<StorefrontKey | null>(null);
  const ref = { slug, id: Number(id), t: token };
  const load = useCallback(() => {
    if (!token) return;
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
  const card = useAction(async () => {
    const r = await webCardPayFn({ data: ref });
    window.location.assign(r.url);
  });
  if (noLink) return <p className="text-sm text-muted">{t("order.noLink")}</p>;
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
      {view.discount > 0 && (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <span>{t("order.discount")}</span>
            <span className="tabular-nums">−{formatMoney(view.discount, view.currency)}</span>
          </div>
          <div className="flex justify-between gap-3 font-semibold">
            <span>{t("cart.total")}</span>
            <span className="tabular-nums">{formatMoney(view.total, view.currency)}</span>
          </div>
        </div>
      )}
      {view.fulfillment?.type && (
        <p className="text-sm">
          {t(view.fulfillment.type === "delivery" ? "order.deliveryOn" : "order.pickupOn", {
            date: view.fulfillment.date ? isoToDisplay(view.fulfillment.date) : "—",
          })}
          {view.fulfillment.zone ? ` · ${view.fulfillment.zone}` : ""}
          {view.fulfillment.address ? ` · ${view.fulfillment.address}` : ""}
        </p>
      )}
      {note && <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">{t(note)}</p>}
      {awaiting && view.payment && (
        <PayBox
          title={t("order.pay")}
          due={view.due}
          currency={view.currency}
          hint={view.due < view.total ? t("order.depositHint") : null}
          payment={view.payment}
          card={card}
          proof={proof}
        />
      )}
      {view.balance && (
        <PayBox
          title={t("order.balanceTitle")}
          due={view.balance.due}
          currency={view.currency}
          hint={t("order.balancePaid", {
            paid: formatMoney(view.balance.paid, view.currency),
            total: formatMoney(view.total, view.currency),
          })}
          payment={view.balance}
          card={card}
          proof={proof}
        />
      )}
      {view.balancePending && !note && (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">{t("order.balancePending")}</p>
      )}
      {checking && !note && (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">
          {t(
            view.gift
              ? "order.gift.waiting"
              : !view.fulfillment
                ? "order.waiting"
                : view.proof
                  ? "order.waitingPhysical"
                  : "order.waitingSeller",
          )}
        </p>
      )}
      {view.gift?.code && (
        <section className="card space-y-2 p-5">
          <h2 className="font-semibold">{t("order.gift.title")}</h2>
          <p className="text-sm">
            {t("order.gift.amount", { sum: formatMoney(view.gift.amount, view.gift.currency) })}
          </p>
          <p className="rounded-md bg-surface-2 px-3 py-2 text-center font-mono text-xl tracking-wider select-all">
            {view.gift.code}
          </p>
          <p className="text-xs text-muted">{t("order.gift.hint")}</p>
        </section>
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
      {/* Баллы копятся у покупателя из бота: не вошедшему — вход с подсказкой. */}
      {login.state?.points && login.state.bot && !login.state.me && !login.inTelegram && (
        <div className="border-t border-line pt-4">
          <TgLoginBox login={login} />
        </div>
      )}
    </div>
  );
}

type Action<A extends unknown[]> = {
  busy: boolean;
  error: unknown;
  run: (...a: A) => Promise<unknown>;
};

/**
 * Как платить: карта через Robokassa продавца и/или перевод по реквизитам с
 * чеком. Сумму и способ даёт сервер — и за заказ, и за остаток по задатку.
 */
function PayBox(props: {
  title: string;
  due: number;
  currency: string;
  hint: string | null;
  payment: { instructions: string | null; qr: string | null; card: boolean };
  card: Action<[]>;
  proof: Action<[File]>;
}) {
  const { t } = useStorefrontLocale();
  const { payment, card, proof } = props;
  return (
    <section className="card space-y-3 p-5">
      <h2 className="font-semibold">{props.title}</h2>
      <p className="text-lg font-semibold tabular-nums">
        {t("order.amount", { sum: formatMoney(props.due, props.currency) })}
      </p>
      {props.hint && <p className="text-xs text-muted">{props.hint}</p>}
      {payment.card && (
        <div className="space-y-1">
          <button
            className="btn-primary w-full"
            disabled={card.busy}
            onClick={() => void card.run().catch(() => {})}
          >
            {t("order.payCard")}
          </button>
          <p className="text-xs text-muted">{t("order.payCardHint")}</p>
          <ErrorBox error={card.error} />
        </div>
      )}
      {payment.card && (payment.instructions || payment.qr) && (
        <h3 className="pt-2 text-sm font-medium">{t("order.payTransfer")}</h3>
      )}
      {payment.instructions && (
        <p className="text-sm whitespace-pre-line">{payment.instructions}</p>
      )}
      {payment.qr && <img src={payment.qr} alt="QR" className="h-48 w-48 rounded object-contain" />}
      {(payment.instructions || payment.qr) && (
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
      )}
    </section>
  );
}
