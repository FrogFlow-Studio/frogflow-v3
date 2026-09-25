import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { dashboardFn, hideSetupFn } from "@/app/admin/admin.functions";
import { Card, Empty, PageTitle, Stat, useAction } from "@/app/ui";
import { formatMoney } from "@/core/money/money";
import { displayNo } from "@/core/orders/pure";
import { OrderStatus } from "./admin._authed.orders";

export const Route = createFileRoute("/admin/_authed/")({
  loader: () => dashboardFn(),
  component: Dashboard,
});

function Dashboard() {
  const d = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
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
  const hide = useAction(async () => {
    await hideSetupFn();
    await router.invalidate();
  });
  return (
    <>
      <PageTitle
        title="Обзор"
        subtitle={`${shop.verticalTitle}${shop.telegram ? ` · @${shop.telegram}` : ""}`}
      />
      {!d.setup.hidden && doneCount < steps.length && (
        <Card
          title={`Первые шаги · ${doneCount} из ${steps.length}`}
          className="mb-6"
          actions={
            <button
              className="btn-ghost text-xs"
              disabled={hide.busy}
              onClick={() => void hide.run().catch(() => {})}
            >
              Скрыть
            </button>
          }
        >
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }}
            />
          </div>
          <p className="mb-3 text-sm text-muted">
            Шаги, после которых магазин продаёт сам. Остальное можно настроить потом.
          </p>
          <ol className="space-y-2 text-sm">
            <Step done={d.setup.telegram} to="/admin/settings" title="Подключить бота в Telegram">
              Создайте бота в @BotFather и вставьте токен в настройках — магазин заработает сразу.
            </Step>
            <Step done={d.setup.products} to="/admin/products" title="Добавить первый товар">
              Название, цена, фото; для цифрового материала — файл, который получит покупатель.
            </Step>
            <Step done={d.setup.payment} to="/admin/settings" title="Указать, как вам платить">
              Реквизиты для перевода по странам или оплата картой через Robokassa.
            </Step>
            <Step
              done={d.setup.notifications}
              to="/admin/settings"
              title="Куда присылать заказы и чеки"
            >
              Ваш Telegram-id в настройках уведомлений: бот пришлёт каждый новый заказ с кнопками
              «подтвердить» и «отклонить». Свой id бот скажет по команде /id.
            </Step>
            <Step done={d.setup.legal} to="/admin/settings" title="Заполнить реквизиты продавца">
              Оферта и реквизиты показываются покупателю в боте и на витрине — это доверие и закон.
            </Step>
            <Step
              done={d.setup.firstOrder}
              to="/admin/orders"
              title="Сделать тестовый заказ на себя"
            >
              Откройте бота, положите товар в корзину, оформите и пришлите любой чек — заказ
              появится здесь, и вы увидите весь путь покупателя.
            </Step>
          </ol>
          {d.setup.slug && (
            <p className="mt-3 text-xs text-muted">
              Витрина магазина: <span className="font-mono">/s/{d.setup.slug}</span>
              {shop.telegram && (
                <>
                  {" "}
                  · бот: <span className="font-mono">t.me/{shop.telegram}</span>
                </>
              )}
            </p>
          )}
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Требуют действия" value={attention} hint="чеки на проверке и готовые заказы" />
        <Stat
          label="Выручка за 30 дней"
          value={formatMoney(d.rev30.total, d.rev30.currency)}
          hint={`${d.rev30.orders} оплаченных заказов`}
        />
        <Stat label="Товаров в продаже" value={d.products} />
        <Stat label="Покупателей" value={d.customers.toLocaleString("ru")} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card
          title="Последние заказы"
          actions={
            <Link to="/admin/orders" className="text-xs text-accent hover:underline">
              все заказы
            </Link>
          }
        >
          {d.recent.length === 0 ? (
            <Empty>Заказов пока нет.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Покупатель</th>
                  <th>Сумма</th>
                  <th>Статус</th>
                  <th>Когда</th>
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
                      {new Date(o.created_at).toLocaleDateString("ru")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Заказы по статусам">
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
          </ul>
        </Card>
      </div>
    </>
  );
}

function Step({
  done,
  to,
  title,
  children,
}: {
  done: boolean;
  to: "/admin/settings" | "/admin/products" | "/admin/orders";
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${done ? "bg-ok text-white" : "border border-line text-muted"}`}
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
        {!done && <p className="text-muted">{children}</p>}
      </div>
    </li>
  );
}
