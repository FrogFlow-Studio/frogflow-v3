import { createFileRoute, Link } from "@tanstack/react-router";
import { platformStatusFn } from "@/app/status/status.functions";

const NAMES: Record<string, string> = {
  bots: "Боты Telegram и Instagram/WhatsApp",
  broadcasts: "Рассылки и уведомления",
  reminders: "Напоминания покупателям",
  instagram: "Ответы на комментарии Instagram",
  vip: "VIP-подписки",
  daily: "Ежедневные задачи",
};
const STATE = {
  ok: ["✅", "Работает"],
  degraded: ["⚠️", "С перебоями"],
  unknown: ["⏳", "Нет данных"],
} as const;

/** Статус платформы для продавцов: без входа и без данных магазинов. */
export const Route = createFileRoute("/status")({
  loader: () => platformStatusFn(),
  head: () => ({ meta: [{ title: "Статус FrogFlow" }] }),
  component: StatusPage,
});

function StatusPage() {
  const s = Route.useLoaderData();
  const [icon, label] = STATE[s.overall];
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <Link to="/" className="text-lg font-semibold">
        🐸 FrogFlow
      </Link>
      <h1 className="mt-6 text-2xl font-semibold">
        {icon} {s.overall === "ok" ? "Все системы работают" : "Есть перебои"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        Обновлено {new Date(s.at).toLocaleString("ru-RU")} · {label}
      </p>
      <ul className="card mt-6 divide-y divide-line">
        <li className="flex justify-between p-3 text-sm">
          <span>Панели, витрины и база данных</span>
          <span>{s.db ? "✅ Работает" : "⚠️ Недоступна"}</span>
        </li>
        {s.services.map((x) => (
          <li key={x.key} className="flex justify-between p-3 text-sm">
            <span>{NAMES[x.key] ?? x.key}</span>
            <span>
              {STATE[x.state][0]} {STATE[x.state][1]}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
