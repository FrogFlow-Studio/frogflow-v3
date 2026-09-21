import { createFileRoute, Link } from "@tanstack/react-router";
import { signupEnabledFn } from "@/app/signup/signup.functions";
import { ThemeToggle } from "@/app/ui";
import { MODULE_KEYS, moduleDef } from "@/core/modules/registry";

export const Route = createFileRoute("/")({
  loader: () => signupEnabledFn().catch(() => ({ enabled: false })),
  component: Landing,
});

const PRODUCTS = [
  {
    icon: "🛍",
    t: "Магазин-бот",
    channels: "Telegram · WhatsApp · Instagram",
    d: "Каталог, корзина, оплата и выдача заказа прямо в переписке. Покупатель не уходит из мессенджера, вы не отвечаете вручную на «сколько стоит» и «как оплатить».",
  },
  {
    icon: "🤖",
    t: "ИИ-консультант",
    channels: "Instagram Direct · WhatsApp · Telegram",
    d: "Отвечает клиентам круглосуточно по вашему прайсу и базе знаний: наличие, размеры, цвета, цены в двух валютах, условия доставки. Не знает — уточняет, а сложное передаёт менеджеру и записывает заявку.",
  },
  {
    icon: "📣",
    t: "Автоматизация Instagram",
    channels: "комментарии · директ · сторис",
    d: "Ответ на комментарий с ключевым словом, сообщение в директ, реакция на «цена?» под сторис, сбор заявок в панель — без ручного мониторинга.",
  },
  {
    icon: "🖥",
    t: "Витрина и Mini App",
    channels: "ссылка · свой домен · внутри Telegram",
    d: "Магазин по ссылке для рекламы и соцсетей, приложение внутри Telegram с корзиной на одном экране. Заказ уходит в тот же бот и ту же панель.",
  },
  {
    icon: "🔁",
    t: "Возврат и удержание",
    channels: "рассылки · напоминания · лояльность",
    d: "Рассылки по сегментам, напоминание о брошенной корзине, промокоды, сертификаты, баллы, рефералы, отзывы — покупатели возвращаются сами.",
  },
  {
    icon: "🧩",
    t: "Под вашу задачу",
    channels: "VIP-подписки · курсы · интеграции",
    d: "Платный доступ в закрытый канал, курсы внутри бота, выгрузки и связки с вашими таблицами и CRM. Расскажите задачу — предложим решение и сроки.",
  },
];

const CHANNELS = [
  {
    icon: "✈️",
    t: "Telegram",
    d: "Магазин-бот, Mini App, чат с менеджером, рассылки, ИИ-консультант, VIP-подписки.",
  },
  {
    icon: "💬",
    t: "WhatsApp",
    d: "Магазин в чате с каталогом и оформлением, автоответчик, переписка из панели, рассылки шаблонами.",
  },
  {
    icon: "📸",
    t: "Instagram",
    d: "ИИ-консультант в директе, магазин в переписке, автоответы на комментарии и сторис, сбор заявок.",
  },
];

const STEPS = [
  {
    n: "1",
    t: "Создайте кабинет",
    d: "Название, ниша, два клика — и у вас есть панель, витрина с собственным адресом и бот в Telegram, как только вставите токен из @BotFather.",
  },
  {
    n: "2",
    t: "Добавьте товары или прайс",
    d: "Фото, цены по странам, варианты, файлы для цифровых товаров. Для консультанта — прайс из Google Таблицы или XLSX и база знаний.",
  },
  {
    n: "3",
    t: "Подключите каналы",
    d: "Telegram сразу, WhatsApp и Instagram — по заявке из панели. Клиент пишет туда, где ему удобно, вы видите всё в одном месте.",
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
    icon: "🛒",
    t: "Магазины с большим прайсом",
    d: "Текстиль, одежда, косметика, техника: ИИ-консультант отвечает по наличию и характеристикам, менеджер подключается к сделке.",
  },
  {
    icon: "💆",
    t: "Услуги и запись",
    d: "Салоны, студии, клиники, эксперты: консультант отвечает на вопросы, записывает и передаёт заявку с контактами.",
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
    a: "Нет. Для Telegram достаточно токена бота из @BotFather, витрина и панель уже готовы. WhatsApp и Instagram подключаем вместе с вами по заявке из панели.",
  },
  {
    q: "Что такое ИИ-консультант и что он знает о моём бизнесе?",
    a: "Это ассистент, который отвечает клиентам в директе и чатах по вашему прайсу и базе знаний: наличие, размеры, цены, условия. Лишнего не выдумывает: не уверен — уточняет или зовёт менеджера. Каждый ответ и его стоимость видны в панели.",
  },
  {
    q: "Работает ли в WhatsApp и Instagram, а не только в Telegram?",
    a: "Да. Магазин в чате, ИИ-консультант и автоответы работают в Instagram Direct и WhatsApp Business; рассылки в WhatsApp идут одобренными шаблонами.",
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
          <a href="#products" className="hidden text-muted hover:text-fg md:inline">
            Что мы делаем
          </a>
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
          <p className="text-sm font-medium text-accent">Telegram · WhatsApp · Instagram</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            Продажи и общение с клиентами в мессенджерах — без ручной рутины
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Магазин-бот, ИИ-консультант и автоматизация в тех каналах, где уже сидят ваши клиенты.
            Заказы, оплата, выдача и ответы на вопросы идут сами, вы видите всё в одной панели.
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
            Без сайта и программиста. Telegram — сразу, WhatsApp и Instagram — по заявке.
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

      {/* Что мы делаем */}
      <section id="products" className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold md:text-3xl">Что мы делаем</h2>
          <p className="mt-2 max-w-2xl text-muted">
            Шесть направлений на одной платформе — включайте нужные, остальное подключится позже без
            переезда.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PRODUCTS.map((p) => (
              <div key={p.t} className="rounded-lg border border-line bg-bg p-5">
                <span className="text-2xl">{p.icon}</span>
                <h3 className="mt-3 font-semibold">{p.t}</h3>
                <p className="mt-1 text-xs font-medium text-accent">{p.channels}</p>
                <p className="mt-2 text-sm text-muted">{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Каналы */}
      <section id="channels" className="mx-auto w-full max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold md:text-3xl">Там, где ваши клиенты</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {CHANNELS.map((c) => (
            <div key={c.t} className="card p-5">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{c.icon}</span>
                <h3 className="font-semibold">{c.t}</h3>
              </div>
              <p className="mt-2 text-sm text-muted">{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Как это работает */}
      <section id="how" className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold md:text-3xl">Три шага до старта</h2>
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
        <h2 className="text-2xl font-semibold md:text-3xl">Что получает ваш бизнес</h2>
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
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
          <h2 className="text-2xl font-semibold md:text-3xl">Начните с Telegram сегодня</h2>
          <p className="mx-auto mt-3 max-w-xl opacity-90">
            Создайте кабинет, добавьте первый товар и отправьте ссылку клиентам. WhatsApp, Instagram
            и ИИ-консультанта подключим следующим шагом.
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
          <span>© FrogFlow · магазины, ИИ-консультанты и автоматизация в мессенджерах</span>
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
