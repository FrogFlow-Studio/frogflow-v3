import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { v4AdvanceFn, v4CaseActionFn, v4ReplyFn, v4TodayFn } from "@/app/admin/v4-today.functions";
import { intlLocale } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { canEdit } from "@/core/auth/roles";
import { isPanelAction, type PanelAction } from "@/v4/screens/actions";
import { panelT, type PanelKey } from "@/v4/screens/panel-texts";
import type { CaseCard, Light } from "@/v4/screens/screens";
import type { DeskOrder } from "@/app/admin/v4-today.server";

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
  if (!order.nextStep || !canEdit(shop.role)) {
    return (
      <li>
        №{order.no} · {(order.dueMinor / 100).toFixed(2)} {order.currency}
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span>
        №{order.no} · {(order.dueMinor / 100).toFixed(2)} {order.currency}
      </span>
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
