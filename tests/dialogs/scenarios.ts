/**
 * Золотые диалоги: каждый сценарий — реальная поломка или ожидание из жизни
 * (откуда — в `origin`). Новая найденная поломка диалога сначала становится
 * сценарием здесь, потом чинится (CLAUDE.md, «Перед PR»).
 */
import { COPY, type Msg } from "@/channels/telegram/copy";
import type { Locale } from "@/core/i18n/locale";
import type { Channel, Input, Product, Room } from "./harness";
import { BOTS_20 } from "./scenarios-bots";
import { handoffReply, pricelistHandoffReply, unavailableReply } from "@/core/consultant/messages";
import { VOICE_WRITE_TEXT } from "@/channels/zernio/nontext";

/** Позиция прайса консультанта BOVI (consultant_catalog_json). */
export interface PricelistItem {
  id: string;
  name: string;
  category: string;
  size: string;
  colors: string[];
  price_kzt: number;
  stock: boolean;
}

/** Прайс BOVI в сценариях — один на все: кэш прайса держится на клиента. */
const PL_CATALOG: PricelistItem[] = [
  {
    id: "T1",
    name: "Uchino полотенце банное",
    category: "Полотенца",
    size: "50x100",
    colors: ["белый"],
    price_kzt: 9000,
    stock: true,
  },
];
const said = (text: string) => [{ type: "text", text }];

/** Чтение настройки `key` падает исключением (обрыв в клиенте базы). */
const failSettingRead =
  (key: string) =>
  (r: Room): void => {
    const from = r.db.from.bind(r.db);
    r.db.from = (table: string) => {
      const q = from(table);
      if (table !== "app_settings") return q;
      const inOrig = q.in.bind(q);
      q.in = (col: string, vs: unknown[]) => {
        if (vs.includes(key)) throw new Error(`обрыв: ${key} не прочитана`);
        return inOrig(col, vs);
      };
      return q;
    };
  };

/** Ответ подменённой модели консультанта в сценариях. */
const CONSULTANT_SAYS = "Консультант: кирпич М150 есть, 95 ₸ за штуку.";

/** Строка, регулярка или функция от текстов выбранного языка (COPY[locale]). */
export type Says = string | RegExp | ((c: Msg) => string);

export interface Expect {
  /** Бот промолчал: ответов нет. */
  silent?: true;
  /** Сколько ответов ушло на эту реплику. */
  count?: number;
  /** Каждое из этих должно встретиться в ответах. */
  says?: Says[];
  /** Ни одно из этих в ответах не встречается. */
  notSays?: Says[];
  /** Эти кнопки есть в последнем ответе. */
  buttons?: string[];
  /** Этих кнопок в последнем ответе нет (и в нижнем меню Telegram). */
  noButtons?: Says[];
  /** Товаров в корзине. */
  cart?: number;
  /** Подмножество состояния покупателя. */
  state?: Record<string, unknown>;
  /** Сколько уведомлений ушло продавцу на эту реплику. */
  sellerNotices?: number;
  /** Что за эту реплику увидел продавец в Telegram (его ответы от бота). */
  sellerSees?: Says[];
  /** Причин ответов бота в «Чате» не меньше стольки (Б13). */
  reasons?: number;
  /** Сколько предупреждений продавцу поставлено в очередь (outbox) на эту реплику. */
  sellerQueued?: number;
  /** Консультант на паузе после реплики (state.consultant.paused_until в будущем). */
  paused?: boolean;
}

export interface Scenario {
  id: string;
  title: string;
  /** Откуда сценарий: скрин, дата, номер PR или «ожидание». */
  origin: string;
  channel: Channel;
  locale: Locale;
  products?: Product[];
  state?: Record<string, unknown>;
  modules?: Record<string, boolean>;
  /** Ниша клиента; по умолчанию digital (магазин). */
  vertical?: string;
  /**
   * ИИ-консультант: строка — его ответ (модель подменена, маршрут до неё настоящий),
   * null — консультант включён, но не ответил (нет ключа ИИ, сбой до вызова).
   * Не задано — консультант не настроен, как раньше.
   */
  consultant?: string | null;
  /**
   * Консультант по прайсу (BOVI) на настоящем коде: подменён только ответ API
   * модели — `rounds`, по раунду на вызов. Прайс — `catalog`; курса рубля нет
   * (кэш курса и прайса — на клиента, а клиент в комнатах один).
   */
  pricelist?: { catalog: PricelistItem[]; rounds: Array<Array<Record<string, unknown>>> };
  /** Добавка к bots.settings клиента. */
  tenantSettings?: Record<string, unknown>;
  /** Instagram/WhatsApp: отправка покупателю не подтверждена (обрыв, тайм-аут). */
  sendFails?: boolean;
  /** Direct/WhatsApp: реплика идёт через весь разбор входящего (слова «позови человека», пауза). */
  full?: boolean;
  /** Подготовка до первой реплики (например, «продавец ответил руками»). */
  arrange?: (r: Room) => void;
  steps: Array<{ say: Input; expect: Expect }>;
}

export const P1 = "a0000000-0000-4000-8000-000000000001";
export const P2 = "a0000000-0000-4000-8000-000000000002";
export const PRODUCTS: Product[] = [
  { id: P1, name: "018. Прописи" },
  { id: P2, name: "019. Пазлы" },
];

const PHONE = "87770637152";
const KNOWN: Record<Locale, Record<string, string>> = {
  ru: { voice: "Я понимаю только текст", welcome: "Добро пожаловать", cart: "Добавлено в корзину" },
  kk: { voice: "Мен тек мәтінді түсінемін", welcome: "қош келдіңіз", cart: "Себетке қосылды" },
  uz: { voice: "Men faqat matnni tushunaman", welcome: "xush kelibsiz", cart: "Savatga qo‘shildi" },
  en: { voice: "", welcome: "", cart: "" },
};
const LOCALES: Locale[] = ["ru", "kk", "uz"];

/** Один и тот же сценарий на трёх языках. */
function everyLocale(
  make: (l: Locale, k: Record<string, string>) => Omit<Scenario, "locale" | "id"> & { id: string },
  channels: Channel[] = ["instagram"],
): Scenario[] {
  return channels.flatMap((channel, ci) =>
    LOCALES.map((locale) => {
      const s = make(locale, KNOWN[locale]!);
      return {
        ...s,
        channel,
        locale,
        id: `${s.id}-${channel === "telegram" ? "tg" : channel === "whatsapp" ? "wa" : "ig"}-${locale}`,
      } as Scenario;
    }).filter(() => ci >= 0),
  );
}

export const SCENARIOS: Scenario[] = [
  ...BOTS_20,
  // ───── Телефон не коды товаров (Б2, скрин Якова 04.10) ─────
  ...everyLocale(
    () => ({
      id: "phone",
      title: "номер телефона записывается, а не превращается в коды товаров",
      origin: "Б2, скрин Якова 04.10",
      channel: "instagram",
      products: PRODUCTS,
      steps: [
        {
          say: { text: PHONE },
          expect: {
            says: [(c) => c.phoneNoted],
            notSays: ["Не нашёл"],
            cart: 0,
            state: { phone: "+87770637152" },
          },
        },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
  {
    id: "phone-plus-spaces-ig-ru",
    title: "номер с плюсом и пробелами — тот же телефон",
    origin: "Б2",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    steps: [
      { say: { text: "+7 777 063 71 52" }, expect: { cart: 0, state: { phone: "+77770637152" } } },
    ],
  },
  {
    id: "phone-twice-wa-ru",
    title: "тот же номер дважды (двойная доставка вебхука) — один ответ",
    origin: "Б2",
    channel: "whatsapp",
    locale: "ru",
    products: PRODUCTS,
    steps: [
      { say: { text: PHONE }, expect: { count: 1 } },
      { say: { repeat: true }, expect: { silent: true } },
    ],
  },
  // ───── «/start» открывает магазин ─────
  ...everyLocale(() => ({
    id: "start",
    title: "/start в обычной переписке открывает каталог, а не молчит",
    origin: "v2 #312",
    channel: "instagram",
    products: PRODUCTS,
    steps: [{ say: { text: "/start" }, expect: { says: ["018. Прописи", "019. Пазлы"] } }],
  })),
  {
    id: "start-wa-ru",
    title: "/start в WhatsApp — выбор категории",
    origin: "v2 #312",
    channel: "whatsapp",
    locale: "ru",
    products: PRODUCTS,
    steps: [{ say: { text: "/start" }, expect: { says: ["Выберите категорию"] } }],
  },
  ...everyLocale(
    (l, k) => ({
      id: "start",
      title: "/start в Telegram: приветствие на языке покупателя",
      origin: "ожидание",
      channel: "telegram",
      products: PRODUCTS,
      steps: [{ say: { text: "/start" }, expect: { says: ["Тест-магазин", k.welcome!] } }],
    }),
    ["telegram"],
  ),
  // ───── Голосовое, стикер, фото вне оплаты (Б6) ─────
  ...everyLocale(
    (l, k) => ({
      id: "voice",
      title: "голосовое в разговоре с ботом — ответ «понимаю только текст» на своём языке",
      origin: "Б6",
      channel: "instagram",
      products: PRODUCTS,
      state: { direct: { last_reply: "Каталог", last_reply_at: new Date().toISOString() } },
      steps: [{ say: { voice: true }, expect: { says: [k.voice!], buttons: [] } }],
    }),
    ["instagram", "whatsapp"],
  ),
  {
    id: "voice-three-ig-ru",
    title: "три голосовых подряд — один ответ, стикер следом молчит",
    origin: "Б6",
    channel: "instagram",
    locale: "ru",
    state: { direct: { last_reply: "Каталог", last_reply_at: new Date().toISOString() } },
    steps: [
      { say: { voice: true }, expect: { count: 1 } },
      { say: { voice: true }, expect: { silent: true } },
      { say: { sticker: true }, expect: { silent: true } },
    ],
  },
  {
    id: "voice-stranger-ig-ru",
    title: "голосовое тому, с кем бот не говорил, — тишина (пишет продавцу)",
    origin: "Б6",
    channel: "instagram",
    locale: "ru",
    steps: [{ say: { voice: true }, expect: { silent: true } }],
  },
  {
    id: "photo-no-order-ig-ru",
    title: "фото вне оплаты — продавцу уведомление, покупателю один ответ «передал»",
    origin: "Б6",
    channel: "instagram",
    locale: "ru",
    state: { direct: { last_reply: "Каталог", last_reply_at: new Date().toISOString() } },
    steps: [
      { say: { photo: true }, expect: { says: ["Передал ваше фото продавцу"], sellerNotices: 1 } },
      { say: { photo: true }, expect: { silent: true, sellerNotices: 1 } },
    ],
  },
  // ───── Продавец вмешался (Б3) ─────
  {
    id: "seller-typed-silence-ig-ru",
    title: "продавец ответил руками 10 минут назад — бот молчит, номер всё равно записан",
    origin: "Б3",
    channel: "instagram",
    locale: "ru",
    arrange: (r) => r.sellerTyped(10),
    steps: [{ say: { text: PHONE }, expect: { silent: true, state: { phone: "+87770637152" } } }],
  },
  {
    id: "seller-typed-command-ig-ru",
    title: "продавец писал руками, но «каталог» — явная команда: бот отвечает",
    origin: "Б3",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    arrange: (r) => r.sellerTyped(10),
    steps: [{ say: { text: "каталог" }, expect: { says: ["018. Прописи"] } }],
  },
  {
    id: "seller-typed-old-ig-ru",
    title: "реплика продавца старше 30 минут — бот снова отвечает",
    origin: "Б3",
    channel: "instagram",
    locale: "ru",
    arrange: (r) => r.sellerTyped(45),
    steps: [{ say: { text: PHONE }, expect: { says: [(c) => c.phoneNoted] } }],
  },
  // ───── Корзина кодами ─────
  ...everyLocale(
    (l, k) => ({
      id: "codes",
      title: "«1, 2» после каталога — оба товара в корзине",
      origin: "29.09 Education Bot",
      channel: "instagram",
      products: PRODUCTS,
      steps: [
        { say: { text: "каталог" }, expect: { says: ["018. Прописи"] } },
        { say: { text: "1, 2" }, expect: { cart: 2, says: [k.cart!] } },
      ],
    }),
    ["instagram"],
  ),
  {
    id: "cancel-keeps-cart-ig-ru",
    title: "«отмена» не опустошает корзину",
    origin: "ожидание",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    steps: [
      { say: { text: "каталог" }, expect: {} },
      { say: { text: "1, 2" }, expect: { cart: 2 } },
      { say: { text: "отмена" }, expect: { cart: 2, count: 1 } },
    ],
  },
  {
    id: "stranger-question-ig-ru",
    title: "человек с вопросом к продавцу — бот не вмешивается",
    origin: "Educational Bot 29.09",
    channel: "instagram",
    locale: "ru",
    state: {},
    products: PRODUCTS,
    steps: [{ say: { text: "а когда будет новая коллекция?" }, expect: { silent: true } }],
  },
  // ───── Telegram: поиск словами (Б7) и дубли ─────
  ...everyLocale(
    () => ({
      id: "search",
      title: "слово вне шага — найденные товары кнопками",
      origin: "Б7",
      channel: "telegram",
      products: PRODUCTS,
      steps: [{ say: { text: "прописи" }, expect: { buttons: ["018. Прописи"] } }],
    }),
    ["telegram"],
  ),
  {
    id: "search-typo-tg-ru",
    title: "опечатка в одну букву находит товар",
    origin: "Б7",
    channel: "telegram",
    locale: "ru",
    products: PRODUCTS,
    steps: [{ say: { text: "прэписи" }, expect: { buttons: ["018. Прописи"] } }],
  },
  {
    id: "search-nothing-tg-uz",
    title: "ничего не найдено — на языке покупателя и с кнопкой каталога",
    origin: "Б7",
    channel: "telegram",
    locale: "uz",
    products: PRODUCTS,
    steps: [
      {
        say: { text: "ботинки" },
        expect: { says: [(c) => c.searchNothing("ботинки")], buttons: ["📚 Katalog"] },
      },
    ],
  },
  ...everyLocale(
    () => ({
      id: "catalog-word",
      title: "слово «каталог» открывает каталог, а не ищет товар с таким названием",
      origin: "Б14: найдено при составлении набора",
      channel: "telegram",
      products: PRODUCTS,
      steps: [
        {
          say: { text: "каталог" },
          expect: { notSays: ["ничего не найдено", "табылмады", "topilmadi"] },
        },
      ],
    }),
    ["telegram"],
  ),
  {
    id: "phone-tg-ru",
    title: "номер телефона в Telegram не кладёт товары в корзину",
    origin: "Б2",
    channel: "telegram",
    locale: "ru",
    products: PRODUCTS,
    steps: [{ say: { text: PHONE }, expect: { cart: 0 } }],
  },
  {
    id: "duplicate-update-tg-ru",
    title: "повторная доставка того же обновления Telegram — один ответ",
    origin: "Б2 / дубли вебхука",
    channel: "telegram",
    locale: "ru",
    products: PRODUCTS,
    steps: [
      { say: { text: "прописи" }, expect: { count: 1 } },
      { say: { repeat: true }, expect: { silent: true } },
    ],
  },
  {
    id: "voice-tg-kk",
    title: "голосовое в Telegram: один понятный ответ на языке покупателя, корзина пуста",
    origin: "Б6",
    channel: "telegram",
    locale: "kk",
    products: PRODUCTS,
    steps: [{ say: { voice: true }, expect: { count: 1, cart: 0, says: ["мәзірден"] } }],
  },
  // ───── Выбор языка не держит переписку (скрин Якова, BOVI 29.09) ─────
  {
    id: "language-then-question-wa-ru",
    title: "после выбора языка вопрос продавцу — не повтор «Выберите язык»",
    origin: "скрин Якова, переписка с BOVI 29.09",
    channel: "whatsapp",
    locale: "ru",
    products: PRODUCTS,
    steps: [
      { say: { text: "каталог" }, expect: {} },
      { say: { text: "язык" }, expect: { says: ["Выберите язык"] } },
      {
        say: {
          text: "Добрый день. Сегмент где Инстаграм странно работает. Не совпадает с базой товаров в знаниях",
        },
        expect: { notSays: ["Выберите язык"], state: { mode: "idle" } },
      },
    ],
  },
  {
    id: "stranger-question-wa-ru",
    title: "новый человек в WhatsApp с вопросом — бот не спрашивает язык",
    origin: "скрин Якова, переписка с BOVI 29.09",
    channel: "whatsapp",
    locale: "ru",
    state: {},
    products: PRODUCTS,
    steps: [
      {
        say: {
          text: "Вы знаете у меня почему-то в базе отсутствуют новинки,корзинки для белья новые",
        },
        expect: { silent: true },
      },
    ],
  },
  // ───── Язык заголовка корзины (uz не должен падать в русский) ─────
  {
    id: "cart-header-wa-uz",
    title: "корзина на узбекском — заголовок не по-русски",
    origin: "Б14: найдено при составлении набора",
    channel: "whatsapp",
    locale: "uz",
    products: PRODUCTS,
    steps: [
      { say: { text: "каталог" }, expect: {} },
      { say: { text: "1" }, expect: { notSays: ["Ваша корзина"] } },
    ],
  },
  // ───── Консультант, который не продаёт (BOVI 06.10) ─────
  // Модуль магазина из v1 включён, товаров нет: бот не ведёт в пустой каталог,
  // отвечает консультант.
  ...everyLocale(
    () => ({
      id: "consultant-no-shop",
      title: "консультант без товаров: «каталог» и вопрос о товаре — ответ консультанта",
      origin: "BOVI 06.10: модуль dm_shop из v1, 0 товаров — пустой каталог вместо ответа",
      channel: "instagram",
      full: true,
      vertical: "consultant",
      modules: { shop: true },
      consultant: CONSULTANT_SAYS,
      steps: [
        {
          say: { text: "каталог" },
          expect: {
            says: [CONSULTANT_SAYS],
            notSays: [(c) => c.emptyHere, (c) => c.catalogHeader],
          },
        },
        {
          say: { text: "Есть кирпич М150?" },
          expect: { says: [CONSULTANT_SAYS], notSays: [(c) => c.emptyHere] },
        },
        { say: { text: "старт" }, expect: { says: [CONSULTANT_SAYS] } },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
  ...everyLocale(
    (l) => ({
      id: "consultant-no-shop-menu",
      title:
        "консультант без товаров: меню без каталога и корзины, /catalog не ведёт в пустой каталог",
      origin: "BOVI 06.10: меню бота звало в каталог, где нет товаров",
      channel: "telegram",
      vertical: "consultant",
      modules: { shop: true, telegram_mini_app: true },
      consultant: CONSULTANT_SAYS,
      steps: [
        {
          say: { text: "/start" },
          expect: {
            buttons: [COPY[l].instruction],
            noButtons: [(c) => c.catalog, (c) => c.search, (c) => c.cart, (c) => c.myOrders],
          },
        },
        {
          say: { text: "/catalog" },
          expect: {
            notSays: [(c) => c.emptyHere, (c) => c.catalogHeader],
            noButtons: [(c) => c.catalog, (c) => c.cart],
          },
        },
        // Старое нижнее меню у покупателя ещё с кнопкой «Каталог».
        {
          say: { text: "📚 Каталог" },
          expect: { says: [CONSULTANT_SAYS], notSays: [(c) => c.emptyHere] },
        },
      ],
    }),
    ["telegram"],
  ),
  ...everyLocale(
    () => ({
      id: "consultant-no-shop-search",
      title:
        "консультант без товаров: текст в режиме поиска — консультанту, не «ничего не найдено»",
      origin: "BOVI 06.10: поиск по пустому каталогу раньше консультанта",
      channel: "telegram",
      vertical: "consultant",
      modules: { shop: true },
      state: { mode: "search" },
      consultant: CONSULTANT_SAYS,
      steps: [
        {
          say: { text: "Есть кирпич М150?" },
          expect: {
            says: [CONSULTANT_SAYS],
            notSays: [(c) => c.searchNothing("Есть кирпич М150?")],
          },
        },
      ],
    }),
    ["telegram"],
  ),
  ...everyLocale(
    (l) => ({
      id: "consultant-no-shop-silent",
      title: "консультант без товаров не ответил — вопрос менеджеру, а не «ничего не найдено»",
      origin: "BOVI 06.10: при сбое консультанта бот искал по пустому каталогу",
      channel: "telegram",
      vertical: "consultant",
      modules: { shop: true },
      consultant: null,
      steps: [
        {
          say: { text: "Есть кирпич М150?" },
          expect: {
            says: [handoffReply(l)],
            notSays: [(c) => c.searchNothing("Есть кирпич М150?")],
            noButtons: [(c) => c.catalog],
            sellerNotices: 1,
          },
        },
      ],
    }),
    ["telegram"],
  ),
  // Консультант с товарами продаёт как раньше: каталог в меню остаётся.
  {
    id: "consultant-sells-menu-tg-ru",
    title: "консультант с товарами — каталог и корзина в меню на месте",
    origin: "BOVI 06.10: продающий консультант не меняется",
    channel: "telegram",
    locale: "ru",
    vertical: "consultant",
    modules: { shop: true },
    products: PRODUCTS,
    consultant: CONSULTANT_SAYS,
    steps: [{ say: { text: "/start" }, expect: { buttons: ["📚 Каталог", "🛒 Корзина"] } }],
  },
  // ───── Консультант: стикер и голосовое (v1 BOVI handle-message.ts:424-433) ─────
  ...everyLocale(
    (l) => ({
      id: "consultant-sticker-voice",
      title:
        "консультант: стикер — молчит; голосовое — «напишите текстом» один раз; текст — консультант",
      origin:
        "перенос v1 BOVI: v2 отдавал стикер и голосовое модели как «[вложение: …]», модель отвечала невпопад",
      channel: "instagram",
      full: true,
      vertical: "consultant",
      modules: { shop: true },
      consultant: CONSULTANT_SAYS,
      steps: [
        { say: { sticker: true }, expect: { silent: true } },
        {
          say: { voice: true },
          expect: { says: [VOICE_WRITE_TEXT[l]], notSays: [CONSULTANT_SAYS], count: 1 },
        },
        // Второе голосовое подряд: та же просьба не повторяется.
        { say: { voice: true }, expect: { silent: true } },
        { say: { text: "Есть кирпич М150?" }, expect: { says: [CONSULTANT_SAYS] } },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
  // ───── Буквенный код из ключевых слов: «#кпп» (AATeach, Instagram 07.10) ─────
  ...everyLocale(
    () => ({
      id: "tag-keyword",
      title: "«#кпп» в фразе открывает товар, у которого «кпп» в ключевых словах",
      origin: "AATeach, скрин Якова 07.10: «Хочу приобрести #кпп» — бот промолчал",
      channel: "instagram",
      products: [
        { id: P1, name: "018. Прописи", keywords: "кпп, план" },
        { id: P2, name: "019. Пазлы" },
      ],
      steps: [
        {
          say: { text: "Здравствуйте. Хочу приобрести #кпп" },
          expect: { says: ["018. Прописи"], notSays: ["019. Пазлы"], sellerNotices: 0 },
        },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
  {
    id: "tag-keyword-case-ig-ru",
    title: "метка без учёта регистра и решётки у продавца: «#КПП» ↔ «#кпп»",
    origin: "AATeach 07.10",
    channel: "instagram",
    locale: "ru",
    products: [{ id: P1, name: "018. Прописи", keywords: "#кпп" }],
    steps: [{ say: { text: "#КПП" }, expect: { says: ["018. Прописи"] } }],
  },
  {
    id: "tag-keyword-several-ig-ru",
    title: "метка у двух товаров — список обоих с номерами",
    origin: "AATeach 07.10",
    channel: "instagram",
    locale: "ru",
    products: [
      { id: P1, name: "018. Прописи", keywords: "кпп" },
      { id: P2, name: "019. Пазлы", keywords: "пазлы кпп" },
    ],
    steps: [{ say: { text: "Хочу #кпп" }, expect: { says: ["1. 018. Прописи", "2. 019. Пазлы"] } }],
  },
  {
    id: "tag-keyword-part-ig-ru",
    title: "метка — только целое слово: «кппх» в ключевых словах не подходит, бот молчит",
    origin: "AATeach 07.10",
    channel: "instagram",
    locale: "ru",
    products: [{ id: P1, name: "018. Прописи", keywords: "кппх" }],
    steps: [{ say: { text: "Хочу #кпп" }, expect: { silent: true } }],
  },
  {
    id: "tag-keyword-bare-ig-ru",
    title: "«кпп» без решётки — обычная реплика: строгий режим оставляет её продавцу",
    origin: "AATeach 07.10; Educational Bot: бот не просыпается на обычные слова",
    channel: "instagram",
    locale: "ru",
    products: [{ id: P1, name: "018. Прописи", keywords: "кпп" }],
    steps: [{ say: { text: "Кпп" }, expect: { silent: true } }],
  },
  // ───── Консультант BOVI: надёжность ответа (07.10) ─────
  ...everyLocale(
    () => ({
      id: "consultant-send-failed",
      title: "ответ консультанта не ушёл — продавцу «ответ не ушёл», бот не на паузе",
      origin: "BOVI 07.10, разбор: при сбое отправки покупатель молчал, продавец не знал",
      channel: "instagram",
      full: true,
      vertical: "consultant",
      modules: { shop: true },
      consultant: CONSULTANT_SAYS,
      sendFails: true,
      steps: [
        {
          say: { text: "Есть кирпич М150?" },
          expect: { silent: true, sellerNotices: 1, paused: false },
        },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
  {
    id: "pricelist-send-failed-handoff-ig-ru",
    title:
      "передача менеджеру, а фраза покупателю не ушла — продавцу карточка, пауза при менеджере",
    origin: "BOVI 07.10, разбор: пауза записана, а продавец не уведомлён — диалог повис",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    sendFails: true,
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        [
          { type: "text", text: "Передаю менеджеру, он ответит здесь." },
          {
            type: "tool_use",
            id: "h1",
            name: "handoff_to_manager",
            input: { reason: "wholesale", summary: "Опт полотенец для гостиницы" },
          },
        ],
      ],
    },
    steps: [
      {
        say: { text: "Хочу оформить оптовую закупку полотенец для гостиницы" },
        expect: { silent: true, sellerNotices: 1, paused: true },
      },
    ],
  },
  ...everyLocale((l) => ({
    id: "pricelist-model-setting-fails",
    title: "сбой чтения модели консультанта — покупателю «не могу ответить», продавцу передача",
    origin: "BOVI 07.10, разбор: исключение до try — бронь висела, покупатель без ответа",
    channel: "instagram",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: { catalog: PL_CATALOG, rounds: [] },
    arrange: failSettingRead("consultant_model"),
    steps: [
      {
        say: { text: "Есть полотенца?" },
        expect: { says: [unavailableReply(l)], sellerNotices: 1 },
      },
    ],
  })),
  ...everyLocale((l) => ({
    id: "pricelist-wrong-price-twice",
    title: "цена не по прайсу и после переписывания — покупателю передача менеджеру, не цена",
    origin: "BOVI 07.10, разбор: fix:draft_again — ответ с чужой ценой всё равно уходил",
    channel: "instagram",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        said("Uchino полотенце банное 50х100 - 5 000 ₸."),
        said("Uchino полотенце банное 50х100 - 5 000 ₸."),
      ],
    },
    steps: [
      {
        say: { text: "Сколько стоит полотенце Uchino?" },
        expect: {
          says: [pricelistHandoffReply(l)],
          notSays: ["5 000"],
          sellerNotices: 1,
          paused: true,
        },
      },
    ],
  })),
  {
    id: "pricelist-rubles-no-rate-ig-ru",
    title: "рубли без свежего курса — цены в тенге, продавцу одно предупреждение в сутки",
    origin: "BOVI 07.10, разбор: подсказка обещала замену на рубли, а курса не было",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        said("Uchino полотенце банное 50х100 - 9 000 ₸."),
        said("Uchino полотенце банное 50х100 - 9 000 ₸ за штуку."),
      ],
    },
    steps: [
      {
        say: { text: "Сколько в рублях?" },
        expect: { says: ["9 000 ₸"], notSays: ["₽"], sellerQueued: 1 },
      },
      {
        say: { text: "А в рублях за штуку?" },
        expect: { says: ["9 000 ₸ за штуку"], notSays: ["₽"], sellerQueued: 0 },
      },
    ],
  },
];
