import { createFileRoute, Link } from "@tanstack/react-router";
import { signupEnabledFn } from "@/app/signup/signup.functions";
import { ThemeToggle } from "@/app/ui";

export const Route = createFileRoute("/")({
  loader: () => signupEnabledFn().catch(() => ({ enabled: false })),
  component: Landing,
});

/** Главная платформы: три входа — продавец, регистрация, оператор. */
function Landing() {
  const { enabled: signup } = Route.useLoaderData();
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <span className="text-lg font-semibold">🐸 FrogFlow</span>
        <span className="flex items-center gap-4 text-sm">
          <ThemeToggle />
          <Link to="/admin/login" className="text-muted hover:text-fg">
            Вход для продавца
          </Link>
        </span>
      </header>

      <section className="mx-auto w-full max-w-5xl px-4 pt-10 pb-16 md:pt-20">
        <p className="text-sm font-medium text-accent">Платформа магазинов в мессенджерах</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
          Магазин в Telegram, который принимает оплату, выдаёт заказы и напоминает о корзине сам
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Каталог, корзина и оформление в боте и на витрине, чеки и онлайн-оплата, промокоды и
          баллы, рассылки, аналитика — в одной панели продавца. Подключение за пять минут: нужен
          только токен бота.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/admin/login" className="btn-primary px-5 py-2.5 text-base">
            Войти в панель продавца
          </Link>
          {signup && (
            <Link to="/signup" className="btn-secondary px-5 py-2.5 text-base">
              Зарегистрировать магазин
            </Link>
          )}
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 px-4 pb-16 md:grid-cols-3">
        {[
          {
            t: "Бот и витрина",
            d: "Каталог с вариантами и фото, корзина, оформление за три шага, Mini App и витрина /s/адрес с передачей корзины в бота.",
          },
          {
            t: "Оплата без рутины",
            d: "Реквизиты по странам, Robokassa, распознавание чеков и автовыдача файлов, задаток и оплата при получении для физических товаров.",
          },
          {
            t: "Возврат покупателей",
            d: "Рассылки по базе, напоминание о брошенной корзине, промокоды, сертификаты, баллы, рефералы и отзывы.",
          },
          {
            t: "Панель продавца",
            d: "Заказы и покупатели, чат с менеджером, аналитика по дням, выгрузка в Excel, настройки и модули в одном месте.",
          },
          {
            t: "Каналы",
            d: "Telegram сегодня; Instagram Direct и WhatsApp через Zernio — следующая фаза той же платформы.",
          },
          {
            t: "Один деплой",
            d: "Все магазины обслуживает одна платформа с изоляцией данных на уровне базы: обновления приходят всем сразу.",
          },
        ].map((f) => (
          <div key={f.t} className="card p-5">
            <h2 className="font-semibold">{f.t}</h2>
            <p className="mt-2 text-sm text-muted">{f.d}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto border-t border-line">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-muted">
          <span>FrogFlow · платформа магазинов в мессенджерах</span>
          <Link to="/operator/login" className="hover:text-fg">
            Панель оператора
          </Link>
        </div>
      </footer>
    </main>
  );
}
