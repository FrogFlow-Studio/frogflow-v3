import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  v4AddLessonFn,
  v4AdvanceFn,
  v4CaseActionFn,
  v4ReplyFn,
  v4SaveMethodFn,
  v4SaveProductFn,
  v4StocktakeFn,
  v4TodayFn,
} from "@/app/admin/v4-today.functions";
import { intlLocale } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { canEdit } from "@/core/auth/roles";
import { isPanelAction, type PanelAction } from "@/v4/screens/actions";
import { panelT, type PanelKey } from "@/v4/screens/panel-texts";
import type { CaseCard, Light } from "@/v4/screens/screens";
import type { DeskOrder } from "@/app/admin/v4-today.server";
import type { LessonRow, ListedProduct } from "@/v4/core/platform";

/**
 * «Сегодня (v4)»: дела магазина в новой версии платформы. Пока магазин не
 * перенесён в v4, страница только поясняет это — ничего не переключает.
 */
export const Route = createFileRoute("/admin/_authed/v4-today")({
  loader: ({ context }) => v4TodayFn({ data: { lang: context.shop.locale } }),
  component: V4TodayPage,
});

const TONE: Record<Light, "danger" | "warn" | "ok"> = {
  red: "danger",
  yellow: "warn",
  green: "ok",
};
const DOT: Record<Light, string> = { red: "🔴", yellow: "🟡", green: "🟢" };

const MONEY_KEY = {
  unpaid: "moneyUnpaid",
  partial: "moneyPartial",
  paid: "moneySettled",
  overpaid: "moneyOverpaid",
} as const satisfies Record<DeskOrder["moneyState"], PanelKey>;

const METHOD_KEY: Record<string, PanelKey> = {
  transfer: "methodTransfer",
  kaspi: "methodKaspi",
  stripe: "methodStripe",
  prodamus: "methodProdamus",
  apipay: "methodApipay",
  robokassa: "methodRobokassa",
  nowpayments: "methodNowpayments",
};

const STEP_KEY = {
  accepted: "stepAccepted",
  working: "stepWorking",
  ready: "stepReady",
  handed: "stepHanded",
} as const satisfies Record<string, PanelKey>;

const OUTCOME_TEXT: Partial<Record<string, PanelKey>> = {
  already: "already",
  case_not_found: "already",
  nothing_due: "nothingDue",
  reason_required: "reasonRequired",
};

function V4TodayPage() {
  const view = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = panelT(shop.locale);
  return (
    <>
      <PageTitle title={t("title")} subtitle={t("subtitle")} />
      {view.state === "not_connected" ? (
        <Empty>{t("notConnected")}</Empty>
      ) : view.state === "no_shop" ? (
        <Empty>{t("noShop")}</Empty>
      ) : (
        <>
          <div className="mb-4 space-y-3">
            {view.screen.cards.length === 0 ? (
              <Empty>{t("empty")}</Empty>
            ) : (
              view.screen.cards.map((c) => <CaseRow key={c.id} card={c} />)
            )}
          </div>
          <Card title={t("deskOrders")}>
            {view.orders.length === 0 ? (
              <Empty>{t("empty")}</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {view.orders.map((o) => (
                  <OrderRow key={o.orderId} order={o} />
                ))}
              </ul>
            )}
          </Card>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card title={t("deskCatalog")}>
              {view.products.length === 0 ? (
                <Empty>{t("empty")}</Empty>
              ) : (
                <ul className="space-y-1 text-sm">
                  {view.products.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3">
                      <span className="truncate">{p.title}</span>
                      <span className="tabular-nums text-muted">
                        {(p.priceMinor / 100).toFixed(2)}
                        {p.trackStock ? ` · ${p.onHand}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit(shop.role) ? (
                <ProductDesk products={view.products} lessons={view.lessons} />
              ) : null}
            </Card>
            <Card title={t("deskSales")}>
              {view.sales.length === 0 ? (
                <Empty>{t("empty")}</Empty>
              ) : (
                <ul className="space-y-1 text-sm">
                  {view.sales.map((s) => (
                    <li key={`${s.day}:${s.currency}`} className="flex justify-between gap-3">
                      <span>{s.day}</span>
                      <span className="tabular-nums">
                        {(s.amountMinor / 100).toFixed(2)} {s.currency}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          {canEdit(shop.role) ? (
            <div className="mt-4">
              <Card title={t("methodTitle")}>
                {view.methods.length === 0 ? (
                  <Empty>{t("empty")}</Empty>
                ) : (
                  <ul className="mb-3 space-y-1 text-sm">
                    {view.methods.map((m) => (
                      <li key={m.id}>
                        {t(METHOD_KEY[m.kind] ?? "methodTitle")}
                        {m.country ? ` · ${m.country}` : ""} · {m.currency}
                        {m.details ? ` · ${m.details}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                <MethodForm />
              </Card>
            </div>
          ) : view.methods.length > 0 ? (
            <div className="mt-4">
              <Card title={t("methodTitle")}>
                <ul className="space-y-1 text-sm">
                  {view.methods.map((m) => (
                    <li key={m.id}>
                      {t(METHOD_KEY[m.kind] ?? "methodTitle")}
                      {m.country ? ` · ${m.country}` : ""} · {m.currency}
                      {m.details ? ` · ${m.details}` : ""}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ) : null}
          <div className="mt-4">
            <Card title={t("botDid")}>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span>
                  <b>{view.screen.botDid.orders}</b> {t("orders")}
                </span>
                <span>
                  <b>{view.screen.botDid.paid}</b> {t("paid")}
                </span>
                <span>
                  <b>{view.screen.botDid.delivered}</b> {t("delivered")}
                </span>
                <span>
                  <b>{view.screen.botDid.commentsAnswered}</b> {t("comments")}
                </span>
                <span className="text-muted">
                  {t("aiLeft")}: ${(view.screen.aiRoomMicroUsd / 1_000_000).toFixed(2)}
                </span>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function CaseRow({ card }: { card: CaseCard }) {
  const { shop } = Route.useRouteContext();
  const t = panelT(shop.locale);
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const act = useAction(async (action: PanelAction) => {
    let reason: string | undefined;
    if (action === "receipt_accept" && !confirm(t("confirmAccept"))) return;
    if (action === "receipt_reject") {
      reason = prompt(t("rejectReason"))?.trim() || undefined;
      if (!reason) return;
    }
    const r = await v4CaseActionFn({ data: { caseId: card.id, action, reason } });
    if (!r.ok) {
      const k = OUTCOME_TEXT[r.code];
      setNote(k ? t(k) : r.code);
    }
    await router.invalidate();
  });
  const buttons = [card.primary, card.secondary].filter((b) => isPanelAction(b.action));
  const fmt = (d: Date) =>
    new Date(d).toLocaleString(intlLocale(shop.locale), { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            {DOT[card.light]} {card.title}
          </div>
          {card.subject ? <div className="text-sm text-muted">{card.subject}</div> : null}
        </div>
        {card.dueAt ? (
          <Badge tone={TONE[card.light]}>
            {t("due")}: {fmt(card.dueAt)}
          </Badge>
        ) : null}
      </div>
      {canEdit(shop.role) && card.primary.action === "reply_buyer" ? (
        <ReplyBox caseId={card.id} />
      ) : null}
      {canEdit(shop.role) && buttons.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {buttons.map((b, i) => (
            <button
              key={b.action}
              type="button"
              disabled={act.busy}
              className={i === 0 ? "btn-primary" : "btn-secondary"}
              onClick={() => void act.run(b.action as PanelAction).catch(() => {})}
            >
              {b.label}
            </button>
          ))}
        </div>
      ) : null}
      {note ? <div className="mt-2 text-sm text-muted">{note}</div> : null}
      <ErrorBox error={act.error} />
    </div>
  );
}

function OrderRow({ order }: { order: DeskOrder }) {
  const { shop } = Route.useRouteContext();
  const t = panelT(shop.locale);
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const act = useAction(async () => {
    const r = await v4AdvanceFn({ data: { orderId: order.orderId } });
    if (!r.ok) setNote(r.code);
    await router.invalidate();
  });
  const line = moneyLine(order, t);
  if (!order.nextStep || !canEdit(shop.role)) {
    return <li>{line}</li>;
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span>{line}</span>
      <button
        type="button"
        className="btn-secondary"
        disabled={act.busy}
        onClick={() => void act.run().catch(() => {})}
      >
        {t("deskStep")}: {t(STEP_KEY[order.nextStep])}
      </button>
      {note ? <span className="text-muted">{note}</span> : null}
    </li>
  );
}

function ReplyBox({ caseId }: { caseId: string }) {
  const { shop } = Route.useRouteContext();
  const t = panelT(shop.locale);
  const router = useRouter();
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const act = useAction(async () => {
    const r = await v4ReplyFn({ data: { caseId, text } });
    if (!r.ok) setNote(r.code);
    else {
      setText("");
      setNote(t("saved"));
    }
    await router.invalidate();
  });
  return (
    <form
      className="mt-3 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        void act.run().catch(() => {});
      }}
    >
      <input
        className="input min-w-0 flex-1"
        value={text}
        maxLength={4000}
        placeholder={t("deskReply")}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="btn-secondary" disabled={act.busy || !text.trim()}>
        {t("deskSend")}
      </button>
      {note ? <span className="text-sm text-muted">{note}</span> : null}
    </form>
  );
}

function moneyLine(order: DeskOrder, t: (k: PanelKey) => string): string {
  const paid = `${(order.paidMinor / 100).toFixed(2)} ${order.currency}`;
  const due = `${(order.dueMinor / 100).toFixed(2)} ${order.currency}`;
  const over = `${((order.paidMinor - order.totalMinor) / 100).toFixed(2)} ${order.currency}`;
  const state = t(MONEY_KEY[order.moneyState]);
  if (order.moneyState === "overpaid")
    return `№${order.no} · ${state}: ${t("moneyPaid")} ${paid}, ${t("moneyOver")} ${over}`;
  if (order.moneyState === "paid") return `№${order.no} · ${state}: ${t("moneyPaid")} ${paid}`;
  if (order.moneyState === "partial")
    return `№${order.no} · ${state}: ${t("moneyPaid")} ${paid}, ${t("moneyDue")} ${due}`;
  return `№${order.no} · ${state}: ${t("moneyDue")} ${due}`;
}

function minorOf(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function ProductDesk({ products, lessons }: { products: ListedProduct[]; lessons: LessonRow[] }) {
  const t = panelT(Route.useRouteContext().shop.locale);
  const router = useRouter();
  const [productId, setProductId] = useState<string | null>(null);
  const current = products.find((p) => p.id === productId) ?? null;
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"file" | "club">("file");
  const [price, setPrice] = useState("");
  const [about, setAbout] = useState("");
  const [track, setTrack] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const act = useAction(async () => {
    const priceMinor = minorOf(price);
    if (!title.trim() || priceMinor == null) return;
    const r = await v4SaveProductFn({
      data: {
        title: title.trim(),
        kind,
        priceMinor,
        description: about.trim() || undefined,
        ...(current ? { productId: current.id } : {}),
        trackStock: track,
      },
    });
    if (!r.ok) setNote(r.code);
    else {
      setNote(t("saved"));
      if (!current) {
        setTitle("");
        setPrice("");
        setAbout("");
        setTrack(false);
      }
    }
    await router.invalidate();
  });
  function edit(p: ListedProduct) {
    setProductId(p.id);
    setTitle(p.title);
    setKind(p.kind === "club" ? "club" : "file");
    setPrice((p.priceMinor / 100).toFixed(2));
    setAbout(p.description ?? "");
    setTrack(p.trackStock);
    setNote(null);
  }
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      {products.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {products.map((p) => (
            <button key={p.id} type="button" className="btn-secondary" onClick={() => edit(p)}>
              {t("productEdit")}: {p.title}
            </button>
          ))}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setProductId(null);
              setTitle("");
              setKind("file");
              setPrice("");
              setAbout("");
              setTrack(false);
            }}
          >
            {t("productNew")}
          </button>
        </div>
      ) : null}
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act.run().catch(() => {});
        }}
      >
        <input
          className="input"
          value={title}
          maxLength={200}
          placeholder={t("productTitle")}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <select
            className="input"
            aria-label={t("productKind")}
            value={kind}
            onChange={(e) => setKind(e.target.value === "club" ? "club" : "file")}
          >
            <option value="file">{t("kindFile")}</option>
            <option value="club">{t("kindClub")}</option>
          </select>
          <input
            className="input w-32"
            inputMode="decimal"
            value={price}
            placeholder={t("productPrice")}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <textarea
          className="input min-h-16"
          value={about}
          maxLength={4000}
          placeholder={t("productAbout")}
          onChange={(e) => setAbout(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} />
          {t("productTrack")}
        </label>
        <button type="submit" className="btn-primary w-fit" disabled={act.busy || !title.trim()}>
          {t("save")}
        </button>
        {note ? <span className="text-sm text-muted">{note}</span> : null}
        <ErrorBox error={act.error} />
      </form>
      {current?.trackStock ? <StockBox productId={current.id} /> : null}
      {current?.kind === "club" ? (
        <LessonBox
          productId={current.id}
          lessons={lessons.filter((l) => l.productId === current.id)}
        />
      ) : null}
    </div>
  );
}

function StockBox({ productId }: { productId: string }) {
  const t = panelT(Route.useRouteContext().shop.locale);
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [target, setTarget] = useState("0");
  const [note, setNote] = useState<string | null>(null);
  const act = useAction(async () => {
    const n = Number(target);
    if (!Number.isInteger(n) || n < 0) return;
    if (!key.current) key.current = crypto.randomUUID();
    const r = await v4StocktakeFn({ data: { productId, target: n, externalRef: key.current } });
    setNote(r.ok ? t("saved") : r.code);
    await router.invalidate();
  });
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void act.run().catch(() => {});
      }}
    >
      <input
        className="input w-28"
        inputMode="numeric"
        value={target}
        aria-label={t("stockLabel")}
        onChange={(e) => {
          key.current = null;
          setTarget(e.target.value);
        }}
      />
      <button type="submit" className="btn-secondary" disabled={act.busy}>
        {t("stockSet")}
      </button>
      {note ? <span className="text-sm text-muted">{note}</span> : null}
    </form>
  );
}

function LessonBox({ productId, lessons }: { productId: string; lessons: LessonRow[] }) {
  const t = panelT(Route.useRouteContext().shop.locale);
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const act = useAction(async () => {
    if (!title.trim()) return;
    const r = await v4AddLessonFn({ data: { productId, title: title.trim() } });
    if (!r.ok) setNote(r.code);
    else {
      setTitle("");
      setNote(t("saved"));
    }
    await router.invalidate();
  });
  return (
    <div className="space-y-2">
      {lessons.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {lessons.map((l) => (
            <li key={l.id}>
              {l.position}. {l.title}
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act.run().catch(() => {});
        }}
      >
        <input
          className="input min-w-0 flex-1"
          value={title}
          maxLength={200}
          placeholder={t("lessonLabel")}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" className="btn-secondary" disabled={act.busy || !title.trim()}>
          {t("lessonAdd")}
        </button>
        {note ? <span className="text-sm text-muted">{note}</span> : null}
      </form>
    </div>
  );
}

function MethodForm() {
  const t = panelT(Route.useRouteContext().shop.locale);
  const router = useRouter();
  const [kind, setKind] = useState<
    "transfer" | "kaspi" | "stripe" | "prodamus" | "apipay" | "robokassa" | "nowpayments"
  >("transfer");
  const [country, setCountry] = useState("KZ");
  const [currency, setCurrency] = useState("KZT");
  const [details, setDetails] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const act = useAction(async () => {
    const r = await v4SaveMethodFn({
      data: {
        kind,
        country: country.trim() ? country.trim().toUpperCase() : null,
        currency: currency.trim().toUpperCase(),
        details: details.trim(),
      },
    });
    setNote(r.ok ? t("saved") : r.code);
    if (r.ok) setDetails("");
    await router.invalidate();
  });
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void act.run().catch(() => {});
      }}
    >
      <select
        className="input"
        aria-label={t("methodTitle")}
        value={kind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
      >
        {(
          ["transfer", "kaspi", "stripe", "prodamus", "apipay", "robokassa", "nowpayments"] as const
        ).map((k) => (
          <option key={k} value={k}>
            {t(METHOD_KEY[k]!)}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <input
          className="input w-24"
          value={country}
          maxLength={2}
          placeholder={t("methodCountry")}
          onChange={(e) => setCountry(e.target.value.toUpperCase())}
        />
        <input
          className="input w-28"
          value={currency}
          maxLength={3}
          placeholder={t("methodCurrency")}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
        />
      </div>
      <input
        className="input"
        value={details}
        maxLength={2000}
        placeholder={t("methodDetails")}
        onChange={(e) => setDetails(e.target.value)}
      />
      <button type="submit" className="btn-primary w-fit" disabled={act.busy}>
        {t("save")}
      </button>
      {note ? <span className="text-sm text-muted">{note}</span> : null}
      <ErrorBox error={act.error} />
    </form>
  );
}
