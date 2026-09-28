import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { aiBalanceFn, aiTopupFn } from "@/app/admin/ai-balance.functions";
import { adminT, intlLocale, type AdminKey, type AdminT } from "@/app/i18n/admin";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/admin/_authed/ai-balance")({
  loader: () => aiBalanceFn(),
  component: AiBalancePage,
});

type State = Awaited<ReturnType<typeof aiBalanceFn>>;
type Invoice = Awaited<ReturnType<typeof aiTopupFn>>;

const usdText = (usd: number) =>
  `${usd < 0 ? "−" : ""}$${Math.abs(usd).toFixed(Math.abs(usd) < 0.01 && usd !== 0 ? 4 : 2)}`;

function PayBox({ inv, t, n }: { inv: Invoice; t: AdminT; n: (x: number) => string }) {
  const amount = n(inv.amount);
  return (
    <div className="mt-4 rounded border border-line p-3 text-sm" data-testid="ai-topup-invoice">
      <div className="font-medium">{t("aiBalance.pay.title", { amount, usd: n(inv.usd) })}</div>
      {inv.payUrl ? (
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {inv.qr && (
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(inv.qr)}`}
              alt="QR Kaspi"
              className="h-40 w-40 bg-white"
            />
          )}
          <div className="max-w-sm space-y-2">
            <a
              className="btn-primary inline-block text-xs"
              href={inv.payUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t("aiBalance.pay.open")}
            </a>
            <p className="text-xs text-muted">{t("aiBalance.pay.hint")}</p>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted">{t("aiBalance.pay.transfer", { amount })}</p>
          <pre className="whitespace-pre-wrap text-xs">{inv.requisites}</pre>
        </div>
      )}
    </div>
  );
}

function TopupCard({ s, t, n }: { s: State; t: AdminT; n: (x: number) => string }) {
  const { shop } = Route.useRouteContext();
  const [usd, setUsd] = useState(String(s.min * 2));
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const topup = useAction(async (v: number) => setInvoice(await aiTopupFn({ data: { usd: v } })));
  const value = Number(usd.replace(",", "."));
  const kzt = s.kztPerUsd && Number.isFinite(value) ? Math.round(value * s.kztPerUsd) : null;
  if (shop.role !== "owner")
    return (
      <Card title={t("aiBalance.topup.title")}>
        <p className="text-sm text-muted">{t("aiBalance.topup.ownerOnly")}</p>
      </Card>
    );
  return (
    <Card title={t("aiBalance.topup.title")}>
      <form
        className="grid gap-3 sm:grid-cols-[10rem_auto] sm:items-end"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          void topup.run(value).catch(() => {});
        }}
      >
        <Field
          label={t("aiBalance.topup.amount")}
          hint={t("aiBalance.topup.range", { min: s.min, max: s.max })}
        >
          <input
            className="input"
            name="usd"
            type="number"
            step="1"
            min={s.min}
            max={s.max}
            required
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
          />
        </Field>
        <button className="btn-primary" disabled={topup.busy}>
          {t("aiBalance.topup.button")}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted">
        {kzt && s.kztPerUsd
          ? t("aiBalance.topup.rate", { kzt: n(kzt), rate: n(s.kztPerUsd) })
          : t("aiBalance.topup.noRate")}
      </p>
      <ErrorBox error={topup.error} />
      {invoice && <PayBox inv={invoice} t={t} n={n} />}
    </Card>
  );
}

function AiBalancePage() {
  const s = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const locale = intlLocale(shop.locale);
  const n = (x: number) => x.toLocaleString(locale, { maximumFractionDigits: 2 });
  const last = s.journal[0];
  const empty = s.started && s.usd <= 0;
  const low = s.started && !empty && s.usd < 1;
  return (
    <>
      <PageTitle title={t("aiBalance.title")} subtitle={t("aiBalance.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("aiBalance.left")}>
          <div className="flex items-center gap-2 text-2xl font-semibold" data-testid="ai-balance">
            {usdText(s.usd)}
            {empty ? (
              <Badge tone="danger">{t("aiBalance.empty")}</Badge>
            ) : low ? (
              <Badge tone="warn">{t("aiBalance.low")}</Badge>
            ) : null}
          </div>
          {!s.started && (
            <p className="mt-2 text-sm text-muted">
              {t("aiBalance.notStarted", { amount: usdText(s.usd) })}
            </p>
          )}
        </Card>
        <TopupCard s={s} t={t} n={n} />
      </div>
      <Card title={t("aiBalance.journal.title")} className="mt-4">
        {!last ? (
          <p className="text-sm text-muted">{t("aiBalance.journal.empty")}</p>
        ) : (
          <table className="table">
            <tbody>
              {s.journal.map((r, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap text-muted">
                    {r.type === "ledger"
                      ? new Date(r.at).toLocaleString(locale)
                      : new Date(`${r.date}T12:00:00Z`).toLocaleDateString(locale)}
                  </td>
                  <td>
                    {r.type === "ledger"
                      ? `${t(`aiBalance.kind.${r.kind}` as AdminKey)}${r.note ? ` · ${r.note}` : ""}`
                      : t("aiBalance.spent", {
                          label: t(`aiBalance.use.${r.use}` as AdminKey),
                          calls: r.calls,
                        })}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {r.type === "ledger" ? usdText(r.usd) : usdText(-r.usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
