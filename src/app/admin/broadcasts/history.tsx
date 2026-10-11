import { getRouteApi, useRouteContext, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { cancelBroadcastFn, moreBroadcastsFn } from "@/app/admin/broadcasts.functions";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { Badge, Card, Empty, ErrorBox, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { progressPercent } from "@/core/broadcasts/pure";
import { abCompareState, abVerdict, type AbMoneySide } from "@/core/broadcasts/ab";
import { AUDIENCES, type Broadcast, type Channel, STATUS } from "./shared";
import { HelpTip } from "@/app/admin/help-panel";

/** Поиск и переход страницы рассылок: компонент вынесен из файла маршрута. */
const Route = getRouteApi("/admin/_authed/broadcasts");

export function History({
  broadcasts: firstPage,
  total,
  onlyChannel,
  showChannel,
}: {
  broadcasts: Broadcast[];
  total: number;
  onlyChannel: Channel | null;
  showChannel: boolean;
}) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  // Консультант без продаж: заказов и выручки от рассылки нет — их и не показываем.
  const sells = shop.sells !== false;
  const router = useRouter();
  // «Показать ещё»: страницы после первой, без повторов с обновлённой первой.
  const [more, setMore] = useState<Broadcast[]>([]);
  const firstIds = new Set(firstPage.map((b) => b.id));
  const loaded = [...firstPage, ...more.filter((b) => !firstIds.has(b.id))];
  const broadcasts = loaded.filter((b) => (onlyChannel ? b.channel === onlyChannel : true));
  const loadMore = useAction(async () => {
    const page = await moreBroadcastsFn({ data: { offset: loaded.length } });
    setMore((m) => [...m, ...page.broadcasts]);
  });
  const navigate = Route.useNavigate();
  const cancel = useAction(async (id: string) => {
    if (!confirm(t("broadcasts.history.confirmStop"))) return;
    await cancelBroadcastFn({ data: { id } });
    await router.invalidate();
  });
  const sides = (b: Broadcast): AbMoneySide => ({
    id: b.id,
    sent: b.sent_count,
    clicks: b.clicks,
    orders: b.revenue.orders,
    paid: b.revenue.paid,
    revenue: b.revenue.revenue,
  });
  // Пары A/B-теста: группа → оба варианта; сравнение рисуется один раз, под первым в списке.
  const pairs = new Map<string, { A?: Broadcast; B?: Broadcast }>();
  for (const b of broadcasts) {
    const ab = (b.audience_filter as { ab?: { group?: string; variant?: "A" | "B" } } | null)?.ab;
    if (!ab?.group || !ab.variant) continue;
    pairs.set(ab.group, { ...pairs.get(ab.group), [ab.variant]: b });
  }
  const comparisonShownFor = new Set<string>();
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          {t("broadcasts.history.title")}
          <HelpTip article="broadcasts" anchor="history" />
        </span>
      }
    >
      {broadcasts.length === 0 ? (
        <Empty>{t("broadcasts.history.empty")}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {broadcasts.map((b) => {
            const st = STATUS[b.status];
            const live = b.status === "queued" || b.status === "sending";
            const pct = progressPercent(b);
            const filter = (b.audience_filter ?? {}) as {
              country_code?: string;
              segment?: { kind?: string };
              send_at?: string;
              ab?: { group?: string; variant?: "A" | "B" };
            };
            const audienceKey = AUDIENCES.find(
              (a) => a.value === (filter.segment ? "segment" : b.audience_type),
            )?.label;
            const waiting =
              b.status === "queued" && filter.send_at && Date.parse(filter.send_at) > Date.now();
            return (
              <li key={b.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={st?.tone ?? "neutral"}>{st ? t(st.label) : b.status}</Badge>
                      {showChannel && (
                        <Badge tone="neutral">
                          {b.channel === "whatsapp" ? "WhatsApp" : "Telegram"}
                        </Badge>
                      )}
                      <span className="text-xs text-muted">
                        {new Date(b.created_at).toLocaleString(intlLocale(shop.locale))} ·{" "}
                        {audienceKey ? t(audienceKey) : b.audience_type}
                        {b.audience_type === "country" && ` (${filter.country_code ?? ""})`}
                        {filter.segment?.kind &&
                          ` (${t(`broadcasts.segment.${filter.segment.kind}` as AdminKey)})`}
                      </span>
                      {filter.ab?.variant && (
                        <Badge tone="accent">
                          {t("broadcasts.ab.badge", { v: filter.ab.variant })}
                          {b.sent_count > 0 &&
                            ` · ${Math.round((b.clicks / b.sent_count) * 1000) / 10}%`}
                        </Badge>
                      )}
                      {waiting && (
                        <Badge tone="accent">
                          {t("broadcasts.schedule.at", {
                            at: new Date(filter.send_at!).toLocaleString(intlLocale(shop.locale)),
                          })}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm">
                      {b.channel === "whatsapp"
                        ? t("broadcasts.history.template", {
                            name: b.template_name ?? "",
                            language: b.template_language ?? "",
                          })
                        : b.message_text || t("broadcasts.history.photoOnly")}
                    </p>
                  </div>
                  {sells &&
                    b.channel === "telegram" &&
                    b.status === "completed" &&
                    b.sent_count > 0 &&
                    !filter.ab &&
                    filter.segment?.kind !== "broadcast" && (
                      <button
                        className="btn-ghost text-xs"
                        disabled={b.revenue.windowOpen}
                        title={b.revenue.windowOpen ? t("broadcasts.followup.wait") : undefined}
                        onClick={() =>
                          void navigate({
                            search: { segment: undefined, days: undefined, followup: b.id },
                          }).then(() => window.scrollTo({ top: 0, behavior: "smooth" }))
                        }
                      >
                        {t("broadcasts.followup.button")}
                      </button>
                    )}
                  {live && (
                    <button
                      className="btn-ghost text-xs text-danger"
                      onClick={() => void cancel.run(b.id).catch(() => {})}
                    >
                      {t("broadcasts.history.stop")}
                    </button>
                  )}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full ${b.status === "failed" ? "bg-danger" : "bg-accent"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 flex gap-3 text-xs text-muted tabular-nums">
                  <span>{t("broadcasts.history.total", { n: b.total_count })}</span>
                  <span className="text-ok">
                    {t("broadcasts.history.sent", { n: b.sent_count })}
                  </span>
                  {b.blocked_count > 0 && (
                    <span>
                      {b.channel === "whatsapp"
                        ? t("broadcasts.history.notInWhatsapp", { n: b.blocked_count })
                        : t("broadcasts.history.blocked", { n: b.blocked_count })}
                    </span>
                  )}
                  {b.failed_count > 0 && (
                    <span className="text-danger">
                      {t("broadcasts.history.errors", { n: b.failed_count })}
                    </span>
                  )}
                  {b.channel !== "whatsapp" && b.clicks > 0 && (
                    <span className="text-accent">
                      {t("broadcasts.history.clicks", { n: b.clicks })}
                    </span>
                  )}
                </div>
                {(() => {
                  const g = sells ? filter.ab?.group : undefined;
                  const pair = g ? pairs.get(g) : undefined;
                  if (!g || !pair || comparisonShownFor.has(g)) return null;
                  const state = abCompareState(pair.A, pair.B);
                  if (state === "notSent") return null;
                  if (state === "otherNotLoaded")
                    return (
                      <p className="mt-2 text-xs text-muted">{t("broadcasts.ab.otherBelow")}</p>
                    );
                  if (!pair.A || !pair.B) return null;
                  comparisonShownFor.add(g);
                  const v = abVerdict(sides(pair.A), sides(pair.B));
                  const row = (x: Broadcast, name: "A" | "B") => (
                    <li key={name} className={v.leader === name ? "font-medium text-ok" : ""}>
                      {t("broadcasts.ab.row", {
                        v: name,
                        clicks: x.clicks,
                        orders: x.revenue.orders,
                        money:
                          Object.entries(x.revenue.revenue)
                            .map(([cur, sum]) => formatMoney(sum, cur))
                            .join(", ") || "0",
                      })}
                    </li>
                  );
                  return (
                    <div className="mt-2 rounded-lg border border-line p-2 text-xs">
                      <p className="font-medium">{t("broadcasts.ab.compare")}</p>
                      <ul className="mt-1 space-y-0.5 tabular-nums">
                        {row(pair.A, "A")}
                        {row(pair.B, "B")}
                      </ul>
                      <p className="mt-1 text-muted">
                        {v.leader
                          ? t(
                              v.basis === "revenue"
                                ? "broadcasts.ab.winnerRevenue"
                                : "broadcasts.ab.winnerClicks",
                              { v: v.leader },
                            )
                          : t("broadcasts.ab.noWinner")}
                        {v.lowOrders && ` ${t("broadcasts.ab.lowOrders")}`}
                        {v.mixedCurrency && ` ${t("broadcasts.ab.mixedCurrency")}`}
                      </p>
                    </div>
                  );
                })()}
                {sells && b.sent_count > 0 && (
                  <p className="mt-1 text-xs text-muted tabular-nums">
                    <span className="font-medium text-fg">{t("broadcasts.revenue.label")}</span>{" "}
                    {t("broadcasts.revenue.orders", { n: b.revenue.orders, paid: b.revenue.paid })}
                    {Object.entries(b.revenue.revenue).map(([cur, sum]) => (
                      <span key={cur} className="text-ok">
                        {" · "}
                        {formatMoney(sum, cur)}
                      </span>
                    ))}
                    <span className="block">
                      {t("broadcasts.revenue.hint")}
                      {filter.segment?.kind === "broadcast" &&
                        ` ${t("broadcasts.revenue.hintFollowup")}`}
                      {b.revenue.windowOpen && ` ${t("broadcasts.revenue.windowOpen")}`}
                    </span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {loaded.length < total && (
        <button
          className="btn-secondary mt-3 text-sm"
          disabled={loadMore.busy}
          onClick={() => void loadMore.run().catch(() => {})}
        >
          {t("broadcasts.history.more", { n: total - loaded.length })}
        </button>
      )}
      <ErrorBox error={cancel.error ?? loadMore.error} />
    </Card>
  );
}
