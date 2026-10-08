import { FirstWeekCard } from "@/app/admin/first-week-card";
import { TrialOrder } from "@/app/admin/trial-order";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  applyNicheTemplateFn,
  dashboardFn,
  hideSetupFn,
  skipSetupStepFn,
  removeStarterFn,
} from "@/app/admin/shop.functions";
import { adminT, intlLocale, type AdminKey, type AdminT } from "@/app/i18n/admin";
import { schoolLaunchFn, schoolOverviewFn } from "@/app/admin/courses.functions";
import { verticalTitleKey } from "@/app/i18n/admin/catalog";
import { Badge, Card, Empty, ErrorBox, PageTitle, Stat, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { displayNo } from "@/core/orders/pure";
import { OrderStatus } from "./admin._authed.orders";
import { nextSetupStep, setupProgress, type SetupStep } from "@/app/admin/setup";
import { TIER_TITLES } from "@/core/plans/registry";
import type { LimitNotice } from "@/core/plans/tenant";
import { launchDone, type LaunchStepKey } from "@/core/courses/launch";
import { MovedWelcome } from "@/app/admin/moved-welcome";
import { useLiveOrders } from "@/app/admin/live-orders";
import { waitingTiles } from "@/app/admin/waiting";
import { WaitingCard } from "@/app/admin/waiting-card";
import { PaceCard } from "@/app/admin/pace-card";
import { GrowthCard } from "@/app/admin/growth-card";
import { AiBalanceCard } from "@/app/admin/ai-balance-card";
import { buildAdminNav, consultantWorkspace } from "@/app/admin/nav-model";
import { consultantOverviewFn } from "@/app/admin/workspace.functions";
import { WorkspaceOverview } from "@/app/admin/workspace-ui";
import { roleAllows } from "@/core/auth/roles";
import { sellerTodosFn } from "@/app/admin/todos.functions";
import { SellerTodos, type SellerTodosData } from "@/app/admin/seller-todos-card";

export const Route = createFileRoute("/admin/_authed/")({
  loader: async ({ context }) => {
    // Консультант без продаж (BOVI): сверху «Сегодня» рабочего места. Сбой — плашка, не пустой обзор.
    const [d, workspace, todos] = await Promise.all([
      dashboardFn(),
      consultantWorkspace(context.shop)
        ? consultantOverviewFn().catch((e: unknown) => ({ failed: e }))
        : null,
      // Свои задачи продавца в «Что сделать сегодня»; бухгалтер блока не видит.
      context.shop.role === "accountant"
        ? null
        : sellerTodosFn().catch((e: unknown) => ({ failed: e })),
    ]);
    return { ...d, workspace, todos };
  },
  component: Dashboard,
});

function Dashboard() {
  useLiveOrders();
  const d = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const router = useRouter();
  // «Первые 7 дней» (Р3): пока не закрыты все четыре пункта, они стоят вместо общего «Запуска».
  const firstWeek =
    d.firstWeek && d.firstWeek !== "failed" && d.firstWeek.visible ? d.firstWeek : null;
  // Консультант без продаж (BOVI): без темпа продаж, выручки, товаров и заказов.
  const sells = d.sells;
  const progress = setupProgress(d.setup, d.setup.relevant, d.setup.skipped);
  const next = nextSetupStep(d.setup, d.setup.relevant, d.setup.skipped);
  const skip = useAction(async (step: SetupStep, hide: boolean) => {
    await skipSetupStepFn({ data: { step, skip: hide } });
    await router.invalidate();
  });
  const hide = useAction(async () => {
    await hideSetupFn();
    await router.invalidate();
  });
  const template = useAction(async () => {
    await applyNicheTemplateFn();
    await router.navigate({ to: "/admin/products" });
  });
  const removeStarter = useAction(async () => {
    await removeStarterFn();
    await router.invalidate();
  });
  return (
    <>
      <PageTitle
        title={t("overview.title")}
        subtitle={`${t(verticalTitleKey(shop.vertical))}${shop.telegram ? ` · @${shop.telegram}` : ""}`}
      />
      <div className="grid lg:grid-cols-[2fr_1fr] lg:gap-x-4 lg:[&:has(>aside:empty)]:grid-cols-1 [&>*]:min-w-0">
        <div className="lg:col-start-1">
          {d.workspace && "failed" in d.workspace && (
            <div className="mb-6">
              <ErrorBox error={d.workspace.failed} />
            </div>
          )}
          {d.workspace && !("failed" in d.workspace) && (
            <WorkspaceOverview
              data={d.workspace}
              t={t}
              loc={loc}
              chatOn={Boolean(shop.modules.manager_chat)}
              canEditTasks={roleAllows(shop.role, "manager")}
              modulesLink={roleAllows(shop.role, "admin")}
            />
          )}
          {/* Рабочее место консультанта само показывает задачи и диалоги: магазинные «Ждёт вас»,
              «Что сделать сегодня» и «Покупателей» на нём лишние. */}
          {!d.workspace && (
            <WaitingCard
              tiles={waitingTiles(buildAdminNav(shop), shop, d.counts.awaiting_confirmation ?? 0)}
              t={t}
            />
          )}
          {sells && d.pace && <PaceCard pace={d.pace} t={t} />}
          {sells && (
            <GrowthCard
              growth={d.growth}
              analytics={buildAdminNav(shop).groups.some((g) =>
                g.items.some((i) => i.to === "/admin/analytics"),
              )}
              t={t}
            />
          )}
          {shop.role !== "accountant" && !d.workspace && (
            <TodayCard
              // «Ждёт вас» уже показывает чеки, диалоги и обращения: здесь их нет.
              tasks={d.today.filter((x) => !["receipts", "dialogs", "tickets"].includes(x.key))}
              t={t}
              loc={loc}
              modules={shop.modules}
              todos={d.todos}
              canEdit={roleAllows(shop.role, "manager")}
            />
          )}
        </div>
        {/* Узкая колонка (Ж2): на телефоне идёт сразу после «Сегодня». */}
        <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {shop.role !== "accountant" && d.setup.starter > 0 && (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-line p-3 text-sm">
              <span className="min-w-0 flex-1">{t("overview.starter.banner")}</span>
              <Link to="/admin/products" className="btn-secondary text-sm">
                {t("overview.starter.open")}
              </Link>
              <button
                className="btn-ghost text-sm"
                disabled={removeStarter.busy}
                onClick={() => void removeStarter.run().catch(() => {})}
              >
                {t("overview.starter.remove")}
              </button>
              <ErrorBox error={removeStarter.error} />
            </div>
          )}
          {d.limits.length > 0 && <LimitsCard limits={d.limits} t={t} loc={loc} />}
          {shop.role !== "accountant" && d.setup.moved && (
            <MovedWelcome
              t={t}
              modules={shop.modules}
              payment={d.setup.payment}
              notifications={d.setup.notifications}
              testOrder={d.setup.testOrder}
              sells={sells}
            />
          )}
          {shop.vertical === "courses" && shop.modules.courses && <LaunchCard t={t} />}
          {shop.vertical === "courses" && shop.modules.courses && <SchoolCard t={t} loc={loc} />}
          {firstWeek && <FirstWeekCard state={firstWeek} t={t} />}
          {shop.role !== "accountant" &&
            !d.setup.hidden &&
            progress.percent < 100 &&
            !firstWeek && (
              <Card
                title={`${t(sells ? "launch.title" : "launch.titleConsultant")} · ${t("launch.percent", { n: progress.percent })}`}
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
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <p className="mb-3 text-sm text-muted">
                  {t(sells ? "overview.stepsIntro" : "launch.introConsultant")}
                </p>
                <ol className="space-y-2 text-sm">
                  {progress.rows
                    .filter((r) => !r.skipped)
                    .map((r) => (
                      <Step
                        key={r.step}
                        current={next === r.step ? t("overview.next") : null}
                        done={r.done}
                        to={STEP_LINKS[r.step]}
                        title={stepTitle(r.step, t, sells)}
                        onSkip={() => void skip.run(r.step, true).catch(() => {})}
                        skipLabel={t("launch.skip")}
                      >
                        {r.step === "firstOrder" ? (
                          <>
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
                            <TrialOrder t={t} />
                          </>
                        ) : r.step === "products" ? (
                          t("launch.productsHint", { n: d.setup.productsCount })
                        ) : !sells && r.step === "notifications" ? (
                          t("launch.notificationsConsultantHint")
                        ) : (
                          t(STEP_HINTS[r.step])
                        )}
                      </Step>
                    ))}
                </ol>
                {progress.rows.some((r) => r.skipped) && (
                  <div className="mt-3 text-xs text-muted">
                    {t("launch.skipped")}:{" "}
                    {progress.rows
                      .filter((r) => r.skipped)
                      .map((r) => (
                        <button
                          key={r.step}
                          className="mr-2 underline"
                          onClick={() => void skip.run(r.step, false).catch(() => {})}
                        >
                          {stepTitle(r.step, t, sells)} · {t("launch.restore")}
                        </button>
                      ))}
                  </div>
                )}
                <ErrorBox error={skip.error} />
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
                        · {t("overview.bot")}{" "}
                        <span className="font-mono">t.me/{shop.telegram}</span>
                      </>
                    )}
                  </p>
                )}
              </Card>
            )}
          {shop.role === "owner" && <AiBalanceCard t={t} />}
        </aside>
        <div className="lg:col-start-1">
          {(sells || !d.workspace) && (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {sells && shop.role !== "accountant" && (
                <>
                  <Stat
                    label={t("today.rev1")}
                    value={formatMoney(d.rev1.total, d.rev1.currency)}
                  />
                  <Stat
                    label={t("today.rev7")}
                    value={formatMoney(d.rev7.total, d.rev7.currency)}
                    hint={t("overview.paidOrders", { n: d.rev7.orders })}
                  />
                </>
              )}
              {sells && (
                <>
                  <Stat
                    label={t("overview.revenue30")}
                    value={formatMoney(d.rev30.total, d.rev30.currency)}
                    hint={t("overview.paidOrders", { n: d.rev30.orders })}
                  />
                  <Stat label={t("overview.productsOnSale")} value={d.products} />
                </>
              )}
              {!d.workspace && (
                <Stat label={t("overview.customers")} value={d.customers.toLocaleString(loc)} />
              )}
            </div>
          )}
          <div className="mt-6 grid gap-4 [&>*]:min-w-0">
            {sells && (
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
                  <div className="overflow-x-auto">
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
                            <td className="text-muted">
                              {new Date(o.created_at).toLocaleDateString(loc)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const STEP_LINKS: Record<SetupStep, "/admin/settings" | "/admin/products" | "/admin/orders"> = {
  telegram: "/admin/settings",
  products: "/admin/products",
  payment: "/admin/settings",
  delivery: "/admin/settings",
  notifications: "/admin/settings",
  legal: "/admin/settings",
  botTexts: "/admin/settings",
  firstOrder: "/admin/orders",
};

const STEP_TITLES = {
  telegram: "overview.step.telegram",
  products: "launch.products",
  payment: "overview.step.payment",
  delivery: "launch.delivery",
  notifications: "overview.step.notifications",
  legal: "overview.step.legal",
  botTexts: "launch.botTexts",
  firstOrder: "overview.step.firstOrder",
} as const satisfies Record<SetupStep, AdminKey>;

const STEP_HINTS = {
  telegram: "overview.step.telegramHint",
  products: "launch.productsHint",
  payment: "overview.step.paymentHint",
  delivery: "launch.deliveryHint",
  notifications: "overview.step.notificationsHint",
  legal: "overview.step.legalHint",
  botTexts: "launch.botTextsHint",
  firstOrder: "overview.step.firstOrderHint",
} as const satisfies Record<SetupStep, AdminKey>;

function stepTitle(step: SetupStep, t: AdminT, sells = true): string {
  // Консультант без продаж получает заявки, а не заказы и чеки.
  if (!sells && step === "notifications") return t("launch.notificationsConsultant");
  return t(STEP_TITLES[step]);
}

function Step({
  current,
  done,
  to,
  title,
  children,
  onSkip,
  skipLabel,
}: {
  /** Подпись «Следующий шаг» у самого раннего несделанного, иначе null. */
  current: string | null;
  done: boolean;
  to: "/admin/settings" | "/admin/products" | "/admin/orders";
  title: string;
  children: ReactNode;
  onSkip?: () => void;
  skipLabel?: string;
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
        {!done && onSkip && (
          <button className="btn-ghost ml-2 text-[11px]" onClick={onSkip}>
            {skipLabel}
          </button>
        )}
        {!done && <div className="text-muted">{children}</div>}
      </div>
    </li>
  );
}

/** Онлайн-школа: чеклист запуска (core/courses/launch), пока не пройдены все шаги. */
function LaunchCard({ t }: { t: AdminT }) {
  const [launch, setLaunch] = useState<Awaited<ReturnType<typeof schoolLaunchFn>> | null>(null);
  useEffect(() => {
    void schoolLaunchFn().then(setLaunch, () => setLaunch(null));
  }, []);
  if (!launch) return null;
  const { steps, hints } = launch;
  // Подсказка про эфиры без ссылки живёт и после прохождения шагов.
  if (launchDone(steps) && hints.length === 0) return null;
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
      {hints.map((h) => (
        <div
          key={h.key}
          className="mt-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm"
        >
          {t("launch.liveNoLinkHint", { n: h.n })}
        </div>
      ))}
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

/** Лимиты тарифа от 80 %: понятная причина и цена плана выше, ничего не блокируется. */
function LimitsCard({ limits, t, loc }: { limits: LimitNotice[]; t: AdminT; loc: string }) {
  const over = limits.some((l) => l.level === "over");
  const next = limits[0]?.next ?? null;
  return (
    <Card title={t("limits.title")} className="mb-6">
      <div className="space-y-3 text-sm">
        {limits.map((l) => (
          <div key={l.key}>
            <div className="flex justify-between gap-3">
              <span>{t(l.key === "aiDialogs" ? "limits.aiDialogs" : "limits.receiptChecks")}</span>
              <span className="tabular-nums text-muted">
                {t("limits.used", { used: l.used, limit: l.limit })}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full ${l.level === "over" ? "bg-danger" : "bg-accent"}`}
                style={{ width: `${l.percent}%` }}
              />
            </div>
          </div>
        ))}
        <p className="text-muted">{t(over ? "limits.over" : "limits.near")}</p>
        {next ? (
          <Link to="/admin/modules" className="btn-secondary text-sm">
            {t("limits.upgrade", {
              tier: TIER_TITLES[next.tier],
              price: next.monthly.toLocaleString(loc),
              connection: next.connection.toLocaleString(loc),
            })}
          </Link>
        ) : (
          <p className="text-muted">{t("limits.top")}</p>
        )}
      </div>
    </Card>
  );
}

type Today = (typeof Route)["types"]["loaderData"]["today"];

function TodayCard({
  tasks,
  t,
  loc,
  modules,
  todos,
  canEdit,
}: {
  tasks: Today;
  t: AdminT;
  loc: string;
  modules: Record<string, boolean | undefined>;
  todos: SellerTodosData | { failed: unknown } | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const row = (task: Today[number]) => {
    const label = t(`today.${task.key}`);
    const count =
      task.count === null ? (
        <span className="text-sm text-danger">{t("today.unknown")}</span>
      ) : (
        <Badge tone="accent">{task.count}</Badge>
      );
    const cls = "flex items-center justify-between gap-3 py-2 text-sm hover:underline";
    switch (task.key) {
      case "receipts":
        return (
          <Link to="/admin/orders" search={{ status: "awaiting_confirmation" }} className={cls}>
            {label}
            {count}
          </Link>
        );
      case "newOrders":
        return (
          <Link to="/admin/orders" search={{ status: "accepted" }} className={cls}>
            {label}
            {count}
          </Link>
        );
      case "ready":
        return (
          <Link to="/admin/orders" search={{ status: "ready" }} className={cls}>
            {label}
            {count}
          </Link>
        );
      case "dialogs":
        return (
          <Link to="/admin/chat" className={cls}>
            {label}
            {count}
          </Link>
        );
      case "tickets":
        return (
          <Link to="/admin/tickets" className={cls}>
            {label}
            {count}
          </Link>
        );
      case "lowStock":
        return (
          <Link
            to={modules.warehouse ? "/admin/warehouse/requests" : "/admin/products"}
            className={cls}
          >
            {label}
            {count}
          </Link>
        );
    }
  };
  return (
    <Card
      title={t("today.title")}
      className="mb-6"
      actions={
        <button className="btn-ghost text-xs" onClick={() => void router.invalidate()}>
          {t("today.retry")}
        </button>
      }
    >
      <p className="mb-2 text-xs text-muted">{t("todos.hint")}</p>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted">
          {todos && !("failed" in todos) ? t("todos.systemEmpty") : t("today.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map((task) => (
            <li key={task.key}>{row(task)}</li>
          ))}
        </ul>
      )}
      {todos && "failed" in todos ? (
        <div className="mt-3">
          <ErrorBox error={todos.failed} />
        </div>
      ) : todos ? (
        <SellerTodos data={todos} t={t} loc={loc} canEdit={canEdit} />
      ) : null}
    </Card>
  );
}
