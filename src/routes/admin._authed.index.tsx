import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { applyNicheTemplateFn, dashboardFn, hideSetupFn } from "@/app/admin/admin.functions";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { schoolLaunchFn, schoolOverviewFn } from "@/app/admin/courses.functions";
import { verticalTitleKey } from "@/app/i18n/admin/catalog";
import { Badge, Card, Empty, ErrorBox, PageTitle, Stat, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { displayNo } from "@/core/orders/pure";
import { OrderStatus } from "./admin._authed.orders";
import { nextSetupStep } from "@/app/admin/setup";
import { launchDone, type LaunchStepKey } from "@/core/courses/launch";
import { MovedWelcome } from "@/app/admin/moved-welcome";
import { useLiveOrders } from "@/app/admin/live-orders";

export const Route = createFileRoute("/admin/_authed/")({
  loader: () => dashboardFn(),
  component: Dashboard,
});

function Dashboard() {
  useLiveOrders();
  const d = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const router = useRouter();
  const attention = (d.counts.awaiting_confirmation ?? 0) + (d.counts.ready ?? 0);
  const steps = [
    d.setup.telegram,
    d.setup.products,
    d.setup.payment,
    d.setup.notifications,
    d.setup.legal,
    d.setup.firstOrder,
  ];
  const doneCount = steps.filter(Boolean).length;
  const next = nextSetupStep(d.setup);
  const hide = useAction(async () => {
    await hideSetupFn();
    await router.invalidate();
  });
  const template = useAction(async () => {
    await applyNicheTemplateFn();
    await router.navigate({ to: "/admin/products" });
  });
  return (
    <>
      <PageTitle
        title={t("overview.title")}
        subtitle={`${t(verticalTitleKey(shop.vertical))}${shop.telegram ? ` · @${shop.telegram}` : ""}`}
      />
      {d.setup.moved && (
        <MovedWelcome
          t={t}
          modules={shop.modules}
          payment={d.setup.payment}
          notifications={d.setup.notifications}
          testOrder={d.setup.testOrder}
        />
      )}
      {shop.vertical === "courses" && shop.modules.courses && <LaunchCard t={t} />}
      {shop.vertical === "courses" && shop.modules.courses && <SchoolCard t={t} loc={loc} />}
      {!d.setup.hidden && doneCount < steps.length && (
        <Card
          title={`${t("overview.steps")} · ${t("overview.stepsOf", { done: doneCount, total: steps.length })}`}
          className="mb-6"
          actions={
            <button
              className="btn-ghost text-xs"
              disabled={hide.busy}
              onClick={() => void hide.run().catch(() => {})}
            >
              {t("common.hide")}
            </button>
          }
        >
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }}
            />
          </div>
          <p className="mb-3 text-sm text-muted">{t("overview.stepsIntro")}</p>
          <ol className="space-y-2 text-sm">
            <Step
              current={next === "telegram" ? t("overview.next") : null}
              done={d.setup.telegram}
              to="/admin/settings"
              title={t("overview.step.telegram")}
            >
              {t("overview.step.telegramHint")}
            </Step>
            <Step
              current={next === "products" ? t("overview.next") : null}
              done={d.setup.products}
              to="/admin/products"
              title={t("overview.step.products")}
            >
              {t("overview.step.productsHint")}
            </Step>
            <Step
              current={next === "payment" ? t("overview.next") : null}
              done={d.setup.payment}
              to="/admin/settings"
              title={t("overview.step.payment")}
            >
              {t("overview.step.paymentHint")}
            </Step>
            <Step
              current={next === "notifications" ? t("overview.next") : null}
              done={d.setup.notifications}
              to="/admin/settings"
              title={t("overview.step.notifications")}
            >
              {t("overview.step.notificationsHint")}
            </Step>
            <Step
              current={next === "legal" ? t("overview.next") : null}
              done={d.setup.legal}
              to="/admin/settings"
              title={t("overview.step.legal")}
            >
              {t("overview.step.legalHint")}
            </Step>
            <Step
              current={next === "firstOrder" ? t("overview.next") : null}
              done={d.setup.firstOrder}
              to="/admin/orders"
              title={t("overview.step.firstOrder")}
            >
              {"url" in d.setup.testOrder ? (
                <>
                  <a
                    href={d.setup.testOrder.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary my-1 inline-block text-sm"
                  >
                    {t("overview.testOrder.open")}
                  </a>
                  <span className="block">{t("overview.testOrder.how")}</span>
                </>
              ) : d.setup.testOrder.missing === "telegram" ? (
                t("overview.testOrder.needTelegram")
              ) : (
                t("overview.testOrder.needProducts")
              )}
            </Step>
          </ol>
          {d.setup.template && (
            <div className="mt-4 rounded-md border border-line p-3">
              <p className="text-sm font-medium">{t("overview.template.title")}</p>
              <p className="mb-2 text-xs text-muted">{t("overview.template.hint")}</p>
              <button
                className="btn-secondary text-sm"
                disabled={template.busy}
                onClick={() => void template.run().catch(() => {})}
              >
                {t("overview.template.apply")}
              </button>
              <ErrorBox error={template.error} />
            </div>
          )}
          {d.setup.slug && (
            <p className="mt-3 text-xs text-muted">
              {t("overview.storefront")} <span className="font-mono">/s/{d.setup.slug}</span>
              {shop.telegram && (
                <>
                  {" "}
                  · {t("overview.bot")} <span className="font-mono">t.me/{shop.telegram}</span>
                </>
              )}
            </p>
          )}
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label={t("overview.attention")}
          value={attention}
          hint={t("overview.attentionHint")}
        />
        <Stat
          label={t("overview.revenue30")}
          value={formatMoney(d.rev30.total, d.rev30.currency)}
          hint={t("overview.paidOrders", { n: d.rev30.orders })}
        />
        <Stat label={t("overview.productsOnSale")} value={d.products} />
        <Stat label={t("overview.customers")} value={d.customers.toLocaleString(loc)} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card
          title={t("overview.recentOrders")}
          actions={
            <Link to="/admin/orders" className="text-xs text-accent hover:underline">
              {t("overview.allOrders")}
            </Link>
          }
        >
          {d.recent.length === 0 ? (
            <Empty>{t("overview.noOrders")}</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("orders.col.no")}</th>
                  <th>{t("orders.col.customer")}</th>
                  <th>{t("orders.col.total")}</th>
                  <th>{t("orders.col.status")}</th>
                  <th>{t("orders.col.when")}</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        to="/admin/orders/$id"
                        params={{ id: String(o.id) }}
                        className="font-medium hover:underline"
                      >
                        #{displayNo(o)}
                      </Link>
                    </td>
                    <td>{o.display_name}</td>
                    <td className="tabular-nums">{formatMoney(o.total, o.currency)}</td>
                    <td>
                      <OrderStatus status={o.status} />
                    </td>
                    <td className="text-muted">{new Date(o.created_at).toLocaleDateString(loc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title={t("overview.byStatus")}>
          <ul className="space-y-2 text-sm">
            {(
              [
                "awaiting_payment",
                "awaiting_confirmation",
                "delivering",
                "delivered",
                "accepted",
                "in_production",
                "ready",
                "rejected",
              ] as const
            )
              .filter((s) => d.counts[s])
              .map((s) => (
                <li key={s} className="flex items-center justify-between">
                  <Link to="/admin/orders" search={{ status: s }} className="hover:underline">
                    <OrderStatus status={s} />
                  </Link>
                  <span className="tabular-nums">{d.counts[s]}</span>
                </li>
              ))}
            {(d.counts.unpaid ?? 0) > 0 && (
              <li className="flex items-center justify-between">
                <Link to="/admin/orders" search={{ unpaid: true }} className="hover:underline">
                  <Badge tone="warn">{t("physical.unpaid")}</Badge>
                </Link>
                <span className="tabular-nums">{d.counts.unpaid}</span>
              </li>
            )}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Step({
  current,
  done,
  to,
  title,
  children,
}: {
  /** Подпись «Следующий шаг» у самого раннего несделанного, иначе null. */
  current: string | null;
  done: boolean;
  to: "/admin/settings" | "/admin/products" | "/admin/orders";
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${done ? "bg-ok text-white" : current ? "border-2 border-accent text-accent" : "border border-line text-muted"}`}
      >
        {done ? "✓" : ""}
      </span>
      <div>
        {done ? (
          <span className="font-medium text-muted line-through">{title}</span>
        ) : (
          <Link to={to} className="font-medium text-accent hover:underline">
            {title}
          </Link>
        )}
        {current && <span className="badge ml-2 text-[11px]">{current}</span>}
        {!done && <div className="text-muted">{children}</div>}
      </div>
    </li>
  );
}

/** Онлайн-школа: чеклист запуска (core/courses/launch), пока не пройдены все шаги. */
function LaunchCard({ t }: { t: AdminT }) {
  const [steps, setSteps] = useState<Awaited<ReturnType<typeof schoolLaunchFn>> | null>(null);
  useEffect(() => {
    void schoolLaunchFn().then(setSteps, () => setSteps(null));
  }, []);
  if (!steps || launchDone(steps)) return null;
  const done = steps.filter((s) => s.done).length;
  const linkTo: Partial<Record<LaunchStepKey, "/admin/products">> = {
    course: "/admin/products",
    lessons: "/admin/products",
    channel: "/admin/products",
  };
  return (
    <Card
      title={`${t("launch.title")} · ${t("launch.progress", { done, total: steps.length })}`}
      className="mb-4"
    >
      <ol className="space-y-2 text-sm">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2">
            <span className={s.done ? "text-ok" : "text-muted"}>{s.done ? "✓" : "○"}</span>
            <div>
              {!s.done && linkTo[s.key] ? (
                <Link to={linkTo[s.key]!} className="font-medium hover:underline">
                  {t(`launch.${s.key}`)}
                </Link>
              ) : (
                <span className={s.done ? "text-muted line-through" : "font-medium"}>
                  {t(`launch.${s.key}`)}
                </span>
              )}
              {!s.done && <div className="text-muted">{t(`launch.${s.key}Hint`)}</div>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Онлайн-школа: ученики, работы на проверке, отстающие, ближайший старт потока. */
function SchoolCard({ t, loc }: { t: AdminT; loc: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof schoolOverviewFn>> | null>(null);
  useEffect(() => {
    void schoolOverviewFn().then(setD, () => setD(null));
  }, []);
  if (!d) return null;
  return (
    <Card title={t("school.title")} className="mb-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Link to="/admin/products" className="hover:underline">
          <Stat label={t("school.courses")} value={d.courses} />
        </Link>
        <Link to="/admin/students" className="hover:underline">
          <Stat label={t("school.students")} value={d.students} />
        </Link>
        <Link to="/admin/homework" className="hover:underline">
          <Stat label={t("school.homework")} value={d.homeworkWaiting} />
        </Link>
        <Link to="/admin/students" className="hover:underline">
          <Stat label={t("school.behind")} value={d.behind} />
        </Link>
      </div>
      <p className="mt-3 text-sm text-muted">
        {d.nextStart
          ? t("school.nextStart", {
              course: d.nextStart.course,
              cohort: d.nextStart.cohort,
              date: new Date(d.nextStart.at).toLocaleString(loc, {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              }),
            })
          : d.courses === 0
            ? t("school.noCourses")
            : t("school.noStart")}
      </p>
    </Card>
  );
}
