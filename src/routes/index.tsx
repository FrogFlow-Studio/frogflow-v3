import { createFileRoute, Link } from "@tanstack/react-router";
import { signupEnabledFn } from "@/app/signup/signup.functions";
import { ThemeToggle } from "@/app/ui";
import { MODULE_KEYS, moduleDef } from "@/core/modules/registry";

export const Route = createFileRoute("/")({
  loader: () => signupEnabledFn().catch(() => ({ enabled: false })),
  component: Landing,
});

const STEPS = [
  {
    n: "1",
    t: "Создайте магазин",
    d: "Название, ниша, токен бота из @BotFather — и у вас уже есть магазин в Telegram и витрина с собственным адресом.",
  },
  {
    n: "2",
    t: "Добавьте товары",
    d: "Фото, цены по странам, варианты, файлы для цифровых материалов. Категории и остатки — как в обычном магазине.",
  },
  {
    n: "3",
    t: "Делитесь ссылкой",
    d: "Покупатель открывает бота или витрину, выбирает, оплачивает — и получает заказ. Вы видите всё в панели.",
  },
];

const HIGHLIGHTS = [
  {
    icon: "🛍",
    t: "Магазин без сайта",
    d: "Каталог с фото и вариантами прямо в Telegram, витрина по ссылке и Mini App. Корзина сохраняется, оформление — за три шага.",
  },
  {
    icon: "💳",
    t: "Оплата и выдача без вашего участия",
    d: "Реквизиты по странам, карта через Robokassa, чек читается автоматически — файлы уходят покупателю сразу после оплаты.",
  },
  {
    icon: "🔁",
    t: "Покупатели возвращаются сами",
    d: "Напоминание о брошенной корзине, рассылки, промокоды, сертификаты, баллы, рефералы и отзывы.",
  },
  {
    icon: "📊",
    t: "Панель, в которой всё видно",
    d: "Заказы, покупатели, выручка по дням, чат с покупателем, выгрузка в Excel — с телефона или компьютера.",
  },
];

const AUDIENCE = [
  {
    icon: "📚",
    t: "Цифровые товары",
    d: "Учебные материалы, шаблоны, курсы, PDF и видео: файл выдаётся в момент оплаты, версии на нескольких языках.",
  },
  {
    icon: "📦",
    t: "Товары на заказ и с доставкой",
    d: "Кондитерские, цветы, подарки, handmade: дата получения, самовывоз или доставка по зонам, задаток, статусы заказа.",
  },
  {
    icon: "🧑‍💼",
    t: "Прайс и подбор",
    d: "Консультанты и магазины с большим прайсом: умный поиск по смыслу, чат с менеджером, заявки и заказы в одной панели.",
  },
];

/** Полный список возможностей — из реестра модулей, чтобы ничего не забыть. */
const GROUP_ORDER = [
  "База",
  "Оплата",
  "Каталог",
  "Физические товары",
  "Удержание",
  "Сервис",
  "Instagram",
  "WhatsApp",
  "Аналитика",
];
const CAPABILITIES = GROUP_ORDER.map((group) => ({
  group,
  items: MODULE_KEYS.map(moduleDef)
    .filter((d) => d.group === group)
    .map((d) => ({
      title: d.title,
      desc: d.desc,
      soon: d.status !== "available",
      base: d.price === null,
    })),
})).filter((g) => g.items.length > 0);

const FAQ = [
  {
    q: "Нужен ли сайт или программист?",
    a: "Нет. Достаточно токена бота из @BotFather. Витрина и панель уже готовы, вы только заполняете товары.",
  },
  {
    q: "Как покупатели платят?",
    a: "Так, как удобно вам: перевод по реквизитам с проверкой чека, карта через Robokassa, задаток или оплата при получении.",
  },
  {
    q: "Можно ли работать на несколько стран?",
    a: "Да: свои цены и реквизиты для каждой страны, интерфейс бота на русском, казахском, английском и узбекском.",
  },
  {
    q: "Сколько это стоит?",
    a: "Базовые возможности входят в подключение, дополнительные модули включаются по запросу из панели — платите только за то, что используете.",
  },
];

/** Главная платформы — для владельцев магазинов. */
function Landing() {
  const { enabled: signup } = Route.useLoaderData();
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
        <span className="text-lg font-semibold">🐸 FrogFlow</span>
        <nav className="flex items-center gap-5 text-sm">
          <a href="#how" className="hidden text-muted hover:text-fg md:inline">
            Как это работает
          </a>
          <a href="#features" className="hidden text-muted hover:text-fg md:inline">
            Возможности
          </a>
          <a href="#faq" className="hidden text-muted hover:text-fg md:inline">
            Вопросы
          </a>
          <ThemeToggle />
          <Link to="/admin/login" className="btn-secondary">
            Войти
          </Link>
        </nav>
      </header>

      {/* Герой */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-10 pb-16 md:grid-cols-[1.1fr_0.9fr] md:pt-16">
        <div>
          <p className="text-sm font-medium text-accent">Магазин в Telegram за один вечер</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            Продавайте в Telegram — заказы, оплата и выдача идут сами
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            FrogFlow превращает вашего бота в полноценный магазин: покупатель выбирает, платит и
            получает заказ, а вы только смотрите на растущую выручку в панели.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {signup ? (
              <Link to="/signup" className="btn-primary px-5 py-2.5 text-base">
                Открыть магазин бесплатно
              </Link>
            ) : (
              <Link to="/admin/login" className="btn-primary px-5 py-2.5 text-base">
                Войти в панель магазина
              </Link>
            )}
            <a href="#how" className="btn-secondary px-5 py-2.5 text-base">
              Как это работает
            </a>
          </div>
          <p className="mt-4 text-sm text-muted">
            Без сайта и программиста. Нужен только токен бота.
          </p>
        </div>

        {/* Макет диалога с ботом */}
        <div className="card mx-auto w-full max-w-sm overflow-hidden shadow-lg">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent/15 text-lg">
              🛍
            </span>
            <div>
              <div className="text-sm font-semibold">Ваш магазин</div>
              <div className="text-xs text-muted">бот · онлайн</div>
            </div>
          </div>
          <div className="space-y-3 bg-surface-2/60 p-4 text-sm">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-accent-fg">
              🛍 Каталог
            </div>
            <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm bg-surface px-3 py-2 shadow-sm">
              <div className="font-medium">📦 Набор рабочих листов, 1 класс</div>
              <div className="mt-1 text-muted">
                48 страниц, PDF. Файл придёт сразу после оплаты.
              </div>
              <div className="mt-2 font-semibold">💰 1 900 ₸</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs">
                  🛒 В корзину
                </span>
                <span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs">
                  ⭐ 4.9 (37)
                </span>
              </div>
            </div>
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-accent-fg">
              ✅ Оформить заказ
            </div>
            <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm bg-surface px-3 py-2 shadow-sm">
              💳 Оплатите картой или переводом — чек проверю сам.
            </div>
            <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm bg-surface px-3 py-2 shadow-sm">
              🎉 Заказ #128 оплачен. Файл отправлен — приятной работы!
            </div>
          </div>
        </div>
      </section>

      {/* Как это работает */}
      <section id="how" className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold md:text-3xl">Три шага до первой продажи</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="flex gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-lg font-semibold text-accent-fg">
                  {s.n}
                </span>
                <div>
                  <h3 className="font-semibold">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Возможности */}
      <section id="features" className="mx-auto w-full max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold md:text-3xl">Что умеет ваш магазин</h2>
        <p className="mt-2 max-w-2xl text-muted">
          Всё, что раньше требовало сайта, менеджера и трёх сервисов, — в одном боте и одной панели.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {HIGHLIGHTS.map((f) => (
            <div key={f.t} className="card p-5">
              <span className="text-2xl">{f.icon}</span>
              <h3 className="mt-3 font-semibold">{f.t}</h3>
              <p className="mt-2 text-sm text-muted">{f.d}</p>
            </div>
          ))}
        </div>

        <h3 className="mt-14 text-xl font-semibold md:text-2xl">Все возможности по разделам</h3>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Базовые входят в подключение. Остальные включаются по запросу из панели — платите только
          за то, что используете.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((g) => (
            <div key={g.group} className="card p-5">
              <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">
                {g.group}
              </h4>
              <ul className="mt-3 space-y-3">
                {g.items.map((it) => (
                  <li key={it.title} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {it.title}
                      {it.base && (
                        <span className="badge border-accent/30 bg-accent/10 text-accent">
                          в пакете
                        </span>
                      )}
                      {it.soon && <span className="badge">скоро</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{it.desc}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Для кого */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold md:text-3xl">Для кого</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {AUDIENCE.map((a) => (
              <div key={a.t} className="rounded-lg border border-line bg-bg p-5">
                <span className="text-2xl">{a.icon}</span>
                <h3 className="mt-3 font-semibold">{a.t}</h3>
                <p className="mt-2 text-sm text-muted">{a.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Вопросы */}
      <section id="faq" className="mx-auto w-full max-w-3xl px-4 py-16">
        <h2 className="text-2xl font-semibold md:text-3xl">Частые вопросы</h2>
        <dl className="mt-8 divide-y divide-line">
          {FAQ.map((f) => (
            <div key={f.q} className="py-4">
              <dt className="font-semibold">{f.q}</dt>
              <dd className="mt-1 text-sm text-muted">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Призыв */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16">
        <div className="rounded-2xl bg-accent px-6 py-10 text-center text-accent-fg md:px-12">
          <h2 className="text-2xl font-semibold md:text-3xl">Первая продажа — уже сегодня</h2>
          <p className="mx-auto mt-3 max-w-xl opacity-90">
            Создайте магазин, добавьте первый товар и отправьте ссылку покупателям. Остальное бот
            сделает сам.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {signup && (
              <Link
                to="/signup"
                className="inline-flex items-center rounded-md bg-surface px-5 py-2.5 font-medium text-fg hover:opacity-90"
              >
                Открыть магазин
              </Link>
            )}
            <Link
              to="/admin/login"
              className="inline-flex items-center rounded-md border border-accent-fg/40 px-5 py-2.5 font-medium hover:bg-accent-fg/10"
            >
              У меня уже есть магазин
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-muted">
          <span>© FrogFlow · магазины в Telegram</span>
          <span className="flex gap-4">
            <a href="#features" className="hover:text-fg">
              Возможности
            </a>
            <a href="#faq" className="hover:text-fg">
              Вопросы
            </a>
            <Link to="/admin/login" className="hover:text-fg">
              Вход
            </Link>
          </span>
        </div>
      </footer>
    </main>
  );
}
