import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { markNotificationsReadFn, notificationsFn } from "@/app/admin/notifications.functions";
import { adminT, intlLocale, type AdminKey, type AdminT } from "@/app/i18n/admin";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import {
  groupFeed,
  NOTIFY_TYPES,
  type NotifyItem,
  type NotifyType,
} from "@/core/notifications/feed";

export const Route = createFileRoute("/admin/_authed/notifications")({
  loader: () => notificationsFn(),
  component: NotificationsPage,
});

const TYPE_LABEL: Record<NotifyType, AdminKey> = {
  order: "bell.type.order",
  receipt: "bell.type.receipt",
  review: "bell.type.review",
  refund: "bell.type.refund",
};

function itemText(i: NotifyItem, t: AdminT): string {
  const no = i.orderNo ?? "";
  switch (i.type) {
    case "order":
      return t("bell.item.order", { no });
    case "receipt":
      return t("bell.item.receipt", { no });
    case "refund":
      return t("bell.item.refund", { no });
    case "review":
      return t("bell.item.review", { rating: i.rating ?? "" });
  }
}

function Row({ i, t, locale }: { i: NotifyItem; t: AdminT; locale: string }) {
  const loc = intlLocale(locale as never);
  const when = new Date(i.at).toLocaleString(loc, { dateStyle: "short", timeStyle: "short" });
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{itemText(i, t)}</span>
        {!i.read && <Badge tone="accent">{t("bell.new")}</Badge>}
        {i.amount !== null && i.currency && (
          <span className="text-sm text-muted">{formatMoney(i.amount, i.currency)}</span>
        )}
      </span>
      <span className="block text-xs text-muted">
        {when}
        {i.buyer ? ` · ${i.buyer}` : ""}
      </span>
      {i.comment && <span className="block truncate text-sm text-muted">{i.comment}</span>}
    </>
  );
  return (
    <li className="border-b border-line last:border-b-0">
      {i.orderId !== null ? (
        <Link
          to="/admin/orders/$id"
          params={{ id: String(i.orderId) }}
          className="block px-3 py-2 hover:bg-surface-2"
        >
          {body}
        </Link>
      ) : (
        <div className="px-3 py-2">{body}</div>
      )}
    </li>
  );
}

function NotificationsPage() {
  const feed = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [filter, setFilter] = useState<NotifyType | "all">("all");
  const markRead = useAction(async () => {
    await markNotificationsReadFn();
    await router.invalidate();
  });
  const types = NOTIFY_TYPES.filter((x) => feed.items.some((i) => i.type === x));
  const shown = feed.items.filter((i) => filter === "all" || i.type === filter);
  const groups = groupFeed(shown, feed.timezone);
  return (
    <>
      <PageTitle
        title={t("bell.title")}
        subtitle={t("bell.subtitle")}
        actions={
          feed.unread > 0 ? (
            <button
              className="btn-secondary text-sm"
              disabled={markRead.busy}
              onClick={() => void markRead.run().catch(() => {})}
            >
              {t("bell.markRead")}
            </button>
          ) : undefined
        }
      />
      <ErrorBox error={markRead.error} />
      {shop.sells === false && (
        // Консультант без продаж: лента про заказы — говорим, где его события.
        <p className="mb-4 text-sm text-muted">
          {t("bell.consultantNote")}
          {shop.pricelist ? ` ${t("bell.consultantNoteTasks")}` : ""}
        </p>
      )}
      {feed.items.length === 0 ? (
        <Empty>{t("bell.empty")}</Empty>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {(["all", ...types] as const).map((x) => (
              <button
                key={x}
                className={`btn-ghost text-sm ${filter === x ? "font-medium text-accent" : ""}`}
                aria-pressed={filter === x}
                onClick={() => setFilter(x)}
              >
                {x === "all" ? t("bell.filterAll") : t(TYPE_LABEL[x])}
              </button>
            ))}
          </div>
          {(
            [
              ["bell.today", groups.today],
              ["bell.earlier", groups.earlier],
            ] as const
          ).map(
            ([label, list]) =>
              list.length > 0 && (
                <section key={label} className="mb-4">
                  <h2 className="mb-1 text-sm font-medium text-muted">{t(label)}</h2>
                  <ul className="card">
                    {list.map((i) => (
                      <Row key={i.id} i={i} t={t} locale={shop.locale} />
                    ))}
                  </ul>
                </section>
              ),
          )}
          {feed.total > feed.items.length && (
            <p className="text-xs text-muted">
              {t("bell.shown", { n: feed.items.length, total: feed.total })}
            </p>
          )}
        </>
      )}
    </>
  );
}
