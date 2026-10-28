/**
 * Золотые диалоги: каждый сценарий — реальная поломка или ожидание из жизни
 * (откуда — в `origin`). Новая найденная поломка диалога сначала становится
 * сценарием здесь, потом чинится (CLAUDE.md, «Перед PR»).
 */
import { expect } from "vitest";
import { COPY, type Msg } from "@/channels/telegram/copy";
import { EVENING_COPY } from "@/channels/zernio/shop/evening-copy";
import type { Locale } from "@/core/i18n/locale";
import type { Channel, Input, Product, Room } from "./harness";
import { BOTS_20 } from "./scenarios-bots";
import { handoffReply, pricelistHandoffReply, unavailableReply } from "@/core/consultant/messages";
import { VOICE_WRITE_TEXT } from "@/channels/zernio/nontext";
import { rateLimitKey } from "@/core/storefront/rate-limit";
import { CLIENT_CALLS } from "@/core/consultant/rate.server";
import { PLUS_WAIT } from "@/channels/zernio/handle-message";

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
/** Позиция прайса BOVI, которую покупатель называет «полотенце для головы» или «чалма». */
const PL_HAIR_TOWEL: PricelistItem = {
  id: "H1",
  name: "Uchino Полотенце для волос Beauty Hair Strech Towel",
  category: "Полотенца",
  size: "38x80",
  colors: ["серый"],
  price_kzt: 25000,
  stock: true,
};

/** Дозатор Blomus SONO, о цвете которого спрашивала Индира (BOVI 10.10 23:49). */
const PL_DISPENSER: PricelistItem = {
  id: "D1",
  name: "Blomus SONO дозатор для жидкого мыла",
  category: "Аксессуары для ванной",
  size: "",
  colors: ["медный", "чёрный", "розовый"],
  price_kzt: 33000,
  stock: true,
};

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

/** Чтение настройки `key` возвращает ошибку базы (тайм-аут PostgREST), без исключения. */
const errorSettingRead =
  (key: string) =>
  (r: Room): void => {
    const from = r.db.from.bind(r.db);
    r.db.from = (table: string) => {
      const q = from(table);
      if (table !== "app_settings") return q;
      const inOrig = q.in.bind(q);
      q.in = (col: string, vs: unknown[]) =>
        vs.includes(key)
          ? (Promise.resolve({ data: null, error: { message: "timeout" } }) as never)
          : inOrig(col, vs);
      return q;
    };
  };

/** Касса Продамуса на казахстанской форме (кнопка «Картой РФ»), без заказа. */
const prodamusOn = (r: Room): void => {
  r.db.tables.app_settings!.push(
    { key: "prodamus_enabled", value: "true" },
    { key: "prodamus_form_url", value: "https://kopilka.proeducation.kz" },
    { key: "prodamus_secret_key", value: "k".repeat(64) },
    { key: "prodamus_currency", value: "KZT" },
  );
  r.db.tables.payment_methods![0]!.instructions = "Kaspi Gold 4400 4302 1234 5678, Кристина У.";
};

/** Покупатель уже спросил «сколько в сомах?», бот ответил «оплату из вашей страны подключаем». */
const KG_SAID = {
  direct: { foreign_country: "KG", foreign_pay_at: new Date().toISOString() },
};

/** Две страны оплаты, как у AATeach: Казахстан и Россия. */
const twoCountries = (r: Room): void => {
  r.db.tables.payment_methods!.push({
    id: "pm-ru",
    bot_id: r.db.tables.payment_methods![0]!.bot_id,
    is_active: true,
    sort_order: 2,
    country_code: "RU",
    country_name: "🇷🇺 Россия",
    currency: "RUB",
  });
};

/** Две страны и кнопка «Купить» правила, ушедшая этому покупателю в Direct. */
const twoCountriesBuySent = (r: Room): void => {
  twoCountries(r);
  r.db.tables.zernio_logs!.push({
    id: "log-2step",
    bot_id: r.db.tables.payment_methods![0]!.bot_id,
    event_id: "two-step-dm:c1",
    event_type: "two_step_dm_sent",
    status: "processed",
    created_at: new Date().toISOString(),
    payload: {
      username: "someone",
      authorId: "1",
      buttons: [{ type: "postback", title: "Купить", payload: `PROD:${P1}` }],
    },
  });
};

/** Кнопка «Купить» правила «Матрёшки», ушедшая этому покупателю в Direct (магазин только с Kaspi). */
const buySent = (r: Room): void => {
  r.db.tables.zernio_logs!.push({
    id: "log-2step",
    bot_id: r.db.tables.payment_methods![0]!.bot_id,
    event_id: "two-step-dm:c1",
    event_type: "two_step_dm_sent",
    status: "processed",
    created_at: new Date().toISOString(),
    payload: {
      username: "boranbaeva__ainur",
      authorId: "1",
      buttons: [{ type: "postback", title: "Купить", payload: `PROD:${P1}` }],
    },
  });
};

/** Заказ на перевод Kaspi ждёт чек (Копилка: способ оплаты только Казахстан). */
const kaspiOrder = (r: Room): void => {
  paidOrder({ status: "awaiting_payment" })(r);
  r.db.tables.orders![0]!.country_code = "KZ";
  r.db.tables.payment_methods![0]!.instructions = "Kaspi Gold 4400 4302 1234 5678, Кристина У.";
};

/** Копилка с рублями: Россия вторым способом оплаты, цены по странам и «цены во всех валютах». */
const allPrices = (r: Room): void => {
  r.db.tables.payment_methods!.push({
    id: "pm-ru",
    bot_id: r.db.tables.payment_methods![0]!.bot_id,
    is_active: true,
    sort_order: 2,
    country_code: "RU",
    country_name: "Россия",
    currency: "RUB",
  });
  for (const p of r.db.tables.products!) p.country_prices = { KZ: 1500, RU: 490 };
  r.db.tables.app_settings!.push({ key: "card_all_prices", value: "true" });
};

/** Лимит частоты вызовов модели почти исчерпан: пройдёт один вызов, второй — «limited». */
const oneAiCallLeft = (r: Room): void => {
  r.db.tables.app_settings!.push({
    key: rateLimitKey("consultant_ai", "calls"),
    // Окно «из будущего» (часы другого экземпляра спешат): счёт ведётся в нём.
    value: JSON.stringify({ w: 9e15, c: CLIENT_CALLS.limit - 1, p: 0 }),
  });
};

/** Касса Продамуса на казахстанской форме и заказ №15 на 150 ₸, ждущий оплаты. */
const prodamusOrder = (r: Room): void => {
  r.db.tables.app_settings!.push(
    { key: "prodamus_enabled", value: "true" },
    { key: "prodamus_form_url", value: "https://kopilka.proeducation.kz" },
    { key: "prodamus_secret_key", value: "k".repeat(64) },
    { key: "prodamus_currency", value: "KZT" },
  );
  const buyer = r.db.tables.bot_users![0]!;
  r.db.tables.orders!.push({
    id: 15,
    order_no: 15,
    display_no: 15,
    bot_id: buyer.bot_id,
    telegram_id: buyer.telegram_id,
    user_key: buyer.user_key,
    platform: buyer.platform,
    status: "awaiting_payment",
    total: 150,
    currency: "KZT",
    fulfillment_kind: "digital",
    created_at: "2026-10-09T06:21:49Z",
    order_items: [],
  });
};

/** Заказ №82 Копилки (10.10): оплачен картой и выдан; почта и письмо — по сценарию. */
const paidOrder =
  (o: { email?: string; sentAt?: string; status?: string; daysAgo?: number } = {}) =>
  (r: Room): void => {
    const buyer = r.db.tables.bot_users![0]!;
    r.db.tables.orders!.push({
      id: 82,
      order_no: 82,
      display_no: 82,
      bot_id: buyer.bot_id,
      telegram_id: buyer.telegram_id,
      user_key: buyer.user_key,
      platform: buyer.platform,
      status: o.status ?? "delivered",
      total: 1700,
      currency: "KZT",
      fulfillment_kind: "digital",
      customer_email: o.email ?? null,
      created_at: new Date(Date.now() - (o.daysAgo ?? 0) * 86_400_000 - 3 * 60_000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      order_items: [
        {
          id: 1,
          order_id: 82,
          name_snapshot: "Палитра средств выразительности",
          file_url_snapshot: "https://files.example/palitra.pdf",
          file_name_snapshot: "palitra.pdf",
        },
      ],
    });
    if (o.sentAt)
      (r.db.tables.zernio_logs ??= []).push({
        id: "ev-1",
        bot_id: buyer.bot_id,
        event_id: "order:82:email_sent:x",
        event_type: "order.email_sent",
        status: "event",
        created_at: o.sentAt,
        payload: { order_id: 82, actor: "bot", to: o.email, files: 1 },
      });
  };

/** Быстрая покупка выключена: «Купить» кладёт в корзину, дальше «Оформить заказ». */
const noExpress = (r: Room): void => {
  r.db.tables.app_settings!.push({
    key: "instagram_direct_bot_features",
    value: JSON.stringify({ express: false }),
  });
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
  /** Письма покупателю на эту реплику — адреса по порядку (комната с `mail`). */
  mails?: string[];
  /** Что за эту реплику увидел продавец в Telegram (его ответы от бота). */
  sellerSees?: Says[];
  /** Причин ответов бота в «Чате» не меньше стольки (Б13). */
  reasons?: number;
  /** Сколько предупреждений продавцу поставлено в очередь (outbox) на эту реплику. */
  sellerQueued?: number;
  /** Консультант на паузе после реплики (state.consultant.paused_until в будущем). */
  paused?: boolean;
  /**
   * Задачи консультанта в админке (app_settings consultant_tasks_json) после
   * реплики — все, по порядку записи; каждая сверяется подмножеством полей.
   */
  tasks?: Array<Record<string, unknown>>;
  /**
   * Реплики покупателя в истории консультанта (state.consultant.recent) после
   * реплики — каждая ровно один раз: ни потерянных, ни задвоенных.
   */
  history?: string[];
  /**
   * Консультант по прайсу: сколько картинок модель получила в каждом своём
   * вызове на эту реплику (по порядку вызовов).
   */
  modelImages?: number[];
  /** Консультант по прайсу: это было в сообщении, которое видела модель (с пометками). */
  modelSees?: Says[];
  /** Заказы после реплики: id → подмножество полей строки orders. */
  orders?: Record<number, Record<string, unknown>>;
  /** Сколько заказов в базе после реплики (второй заказ на тот же товар — поломка). */
  orderCount?: number;
  /**
   * Сообщений правил Zernio (второй шаг с кнопками, уходит через Zernio, а не
   * ответом бота) на эту реплику — сценарии с `automations`.
   */
  ruleMessages?: number;
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
  consultantOrder?: import("@/core/consultant/engine.server").ConsultantOrderAction;
  /**
   * Консультант по прайсу (BOVI) на настоящем коде: подменён только ответ API
   * модели — `rounds`, по раунду на вызов. Прайс — `catalog`; курса рубля нет, если не задан `rubRate`
   * (кэш курса и прайса — на клиента, а клиент в комнатах один).
   */
  pricelist?: { catalog: PricelistItem[]; rounds: Array<Array<Record<string, unknown>>> };
  /** Консультант по прайсу: свежий курс рубля в магазине (тенге за рубль) — рубли переводит код. */
  rubRate?: number;
  /** Instagram/WhatsApp: ответы бота видны в ленте Zernio, как в жизни (проверка «менеджер в чате»). */
  echoes?: boolean;
  /** Добавка к bots.settings клиента. */
  tenantSettings?: Record<string, unknown>;
  /** Instagram/WhatsApp: отправка покупателю не подтверждена (обрыв, тайм-аут). */
  sendFails?: boolean;
  /** Instagram/WhatsApp: канал отклоняет кнопки (400), текст без кнопок проходит. */
  rejectButtons?: boolean;
  /** Direct/WhatsApp: реплика идёт через весь разбор входящего (слова «позови человека», пауза). */
  full?: boolean;
  /** Instagram/WhatsApp: почта платформы настроена, письма считаются (`mails`). */
  mail?: boolean;
  /** Instagram/WhatsApp: фото чека скачивается — чек принимается. */
  receipts?: boolean;
  /**
   * Чтение чека моделью (core/receipts/reader): ответы инструмента receipt по
   * вызовам — модуль «Распознавание чека» включён, маршрут настоящий, подменён
   * только ответ API модели.
   */
  receiptAi?: Array<Record<string, unknown>>;
  /**
   * ИИ после оплаты (core/postpay): ответы инструмента decide по вызовам —
   * маршрут и исполнение настоящие, подменён только ответ API модели.
   */
  postpay?: Array<{ action: "pass" | "status" | "resend" | "thanks"; email?: string }>;
  /**
   * Страна из слов покупателя (core/country): ответы инструмента country по
   * вызовам — маршрут настоящий, подменён только ответ API модели. Не задано —
   * ключа ИИ нет, работает запасной разбор по названиям.
   */
  countryAi?: Array<{ country: string; answer_only: boolean }>;
  /**
   * Разбор реплики перед обращением (core/inbox/triage): ответы инструмента
   * triage по вызовам — маршрут настоящий, подменён только ответ API модели.
   */
  triage?: Array<{
    kind:
      | "chatter"
      | "foreign_pay"
      | "payment_failed"
      | "cant_send_receipt"
      | "text_receipt"
      | "how_to_pay"
      | "how_to_buy"
      | "several_items"
      | "product_request"
      | "other";
    country?: string;
  }>;
  /**
   * Обычный консультант (не по прайсу) на настоящем runConsultant: ответы API
   * модели по вызовам, после раундов triage. Консультант включён.
   */
  consultantRounds?: Array<Array<Record<string, unknown>>>;
  /** Instagram/WhatsApp: ник покупателя во входящем. */
  username?: string;
  /** Instagram (только `full`): правила комментариев Zernio клиента (список /comment-automations). */
  automations?: Array<Record<string, unknown>>;
  /** Подготовка до первой реплики (например, «продавец ответил руками»). */
  arrange?: (r: Room) => void;
  steps: Array<{ say: Input; expect: Expect }>;
}

export const P1 = "a0000000-0000-4000-8000-000000000001";

/** Правило рилса «Палитра» Копилки: кодовое слово, второе сообщение с «Купить». */
const PALITRA_RULE = {
  id: "pal",
  name: "Палитра",
  accountId: "acc-1",
  trigger: "comment",
  keywords: ["Палитра"],
  isActive: true,
  twoStepDm: true,
  postTitle: 'Пишите в комментариях слово "Палитра" и я вышлю подробную информацию.',
  secondDmMessage: "Палитра средств выразительности — 1700 ₸. Нажмите «Купить»",
  buttons: [{ type: "postback", title: "Купить", payload: `PROD:${P1}` }],
};

/** Карточка «Палитры» ушла `agoMs` назад; переписка помечена её отправкой, как в жизни. */
const palitraSent =
  (username: string, agoMs: number) =>
  (r: Room): void => {
    palitraPending(username)(r);
    const row = r.db.tables.zernio_logs!.at(-1)!;
    const at = new Date(Date.now() - agoMs).toISOString();
    row.event_type = "two_step_dm_sent";
    row.status = "processed";
    (row.payload as Record<string, unknown>).sent_at = at;
    r.db.tables.zernio_logs!.push({
      id: "log-conv",
      bot_id: row.bot_id,
      event_id: "two-step-conv:conv-1",
      event_type: "two_step_conversation",
      status: "processed",
      error_message: `${at}|row:log-pending`,
      created_at: at,
      payload: { conversationId: "conv-1" },
    });
  };

/** Комментарий «Палитра» под рилсом: первое сообщение ушло, второе ждёт ответа покупателя. */
const palitraPending =
  (username: string) =>
  (r: Room): void => {
    r.db.tables.zernio_logs!.push({
      id: "log-pending",
      bot_id: r.db.tables.payment_methods![0]!.bot_id,
      event_id: "two-step-dm:c-pal",
      event_type: "two_step_dm_pending",
      status: "pending",
      error_message: null,
      created_at: new Date(Date.now() - 40_000).toISOString(),
      payload: {
        commentId: "c-pal",
        username,
        authorId: "1",
        accountId: "acc-1",
        automationId: "pal",
        secondText: PALITRA_RULE.secondDmMessage,
        buttons: PALITRA_RULE.buttons,
      },
    });
  };
export const P2 = "a0000000-0000-4000-8000-000000000002";
export const PRODUCTS: Product[] = [
  { id: P1, name: "018. Прописи" },
  { id: P2, name: "019. Пазлы" },
];

const PHONE = "87770637152";
/** Описание карточки длиннее, чем Instagram берёт с кнопками (Палитра Копилки — 1067 знаков). */
const LONG_DESC = "Яркие таблички по литературе: средства выразительности с примерами. ".repeat(16);
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

/**
 * Заказ #221 Копилки (14.10, aliyajanaman): «Матрешки» по «Купить» из
 * автоматизации, чек Kaspi, через минуту продавец выдал. `status` — чтобы
 * проверить и «чек на проверке» (#9 → #15).
 */
const boughtOrder =
  (status: string, minutesAgo = 1) =>
  (r: Room): void => {
    prodamusOn(r);
    const buyer = r.db.tables.bot_users![0]!;
    r.db.tables.orders!.push({
      id: 221,
      order_no: 221,
      display_no: 221,
      bot_id: buyer.bot_id,
      telegram_id: buyer.telegram_id,
      user_key: buyer.user_key,
      platform: buyer.platform,
      status,
      total: 1700,
      currency: "KZT",
      country_code: "KZ",
      fulfillment_kind: "digital",
      payment_proof_path: "proofs/221.jpg",
      created_at: new Date(Date.now() - (minutesAgo + 5) * 60_000).toISOString(),
      updated_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      order_items: [
        {
          id: 2210,
          order_id: 221,
          product_id: P1,
          quantity: 1,
          name_snapshot: "Матрешки",
          file_url_snapshot: "https://files.example/matreshki.pdf",
          file_name_snapshot: "matreshki.pdf",
        },
      ],
    });
  };

export const SCENARIOS: Scenario[] = [
  ...BOTS_20,
  // ───── После оплаты: «отправьте на почту» понимает ИИ (заказ #82 Копилки, 10.10) ─────
  ...everyLocale(() => ({
    id: "postpay-already-sent",
    title:
      "письмо с материалами уже ушло: на «отправьте на почту» бот говорит, куда отправлено, второе письмо не шлёт и продавцу не передаёт",
    origin:
      "заказ #82 Копилки 10.10: письмо ушло 09:41, «Отправьте на почту пожалуйста» ушло Кристине тикетом",
    channel: "instagram",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [{ action: "status" }],
    arrange: paidOrder({
      email: "anna@mail.ru",
      sentAt: new Date(Date.now() - 60_000).toISOString(),
    }),
    steps: [
      {
        say: { text: "Отправьте на почту пожалуйста" },
        expect: { count: 1, says: ["anna@mail.ru"], mails: [], sellerNotices: 0 },
      },
    ],
  })),
  ...everyLocale(() => ({
    id: "postpay-no-email",
    title:
      "почты в выданном заказе нет: бот просит её, а после адреса сразу шлёт письмо и говорит «отправил», не «после проверки оплаты»",
    origin: "Яков 10.10: «или просит почту, или уведомляет и отправляет»; заказ #75 Копилки",
    channel: "instagram",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [{ action: "status" }],
    arrange: paidOrder(),
    steps: [
      {
        say: { text: "Можно на почту?" },
        expect: {
          count: 1,
          says: ["82"],
          mails: [],
          state: { mode: "awaiting_order_email", pending_order_id: 82 },
        },
      },
      {
        say: { text: "anna@mail.ru" },
        expect: {
          count: 1,
          says: ["anna@mail.ru"],
          notSays: [(c) => c.emailSaved("anna@mail.ru")],
          mails: ["anna@mail.ru"],
        },
      },
    ],
  })),
  {
    id: "postpay-resend-new-address-ig-ru",
    title:
      "«не пришло, вот другая почта»: письмо на новый адрес один раз, повтор того же сообщения второго письма не даёт",
    origin: "ожидание к заказу #82 Копилки 10.10",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [
      { action: "resend", email: "new@mail.ru" },
      { action: "resend", email: "new@mail.ru" },
    ],
    arrange: paidOrder({
      email: "old@mail.ru",
      sentAt: new Date(Date.now() - 60_000).toISOString(),
    }),
    steps: [
      {
        say: { text: "Письмо не пришло, отправьте на new@mail.ru" },
        expect: { says: ["new@mail.ru"], mails: ["new@mail.ru"], sellerNotices: 0 },
      },
      { say: { text: "Письмо не пришло, отправьте на new@mail.ru" }, expect: { mails: [] } },
    ],
  },
  {
    id: "postpay-pass-ig-ru",
    title:
      "после оплаты новый вопрос не про заказ — бот не отвечает за продавца, как раньше; письма нет",
    origin: "заказ №77 Копилки 10.10: «Ещё нужен материал к декаде русского языка»",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [{ action: "pass" }],
    arrange: paidOrder({ email: "anna@mail.ru" }),
    steps: [
      {
        say: { text: "Ещё нужен материал к декаде русского языка" },
        expect: { silent: true, mails: [] },
      },
    ],
  },
  {
    id: "postpay-pending-ig-ru",
    title:
      "чек ещё проверяют: на «отправите на почту?» бот говорит, что материалы придут после подтверждения на эту почту",
    origin: "ожидание к заказу #82 Копилки 10.10",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [{ action: "status" }],
    arrange: paidOrder({ email: "anna@mail.ru", status: "awaiting_confirmation" }),
    steps: [
      {
        say: { text: "А на почту отправите?" },
        expect: { count: 1, says: ["подтверд", "anna@mail.ru"], mails: [] },
      },
    ],
  },
  {
    id: "postpay-thanks-after-delivery-ig-ru",
    title:
      "«Благодарю! 🌹» после выдачи: бот один раз отвечает «Рада помочь», обращение не открывается и продавцу ничего не приходит; второе «спасибо» — тишина",
    origin: "Копилка 11.10, срез 77: «Благодарю ! 🌹» после выдачи #132 открыло обращение #123",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [{ action: "thanks" }, { action: "thanks" }],
    arrange: paidOrder({ email: "anna@mail.ru" }),
    steps: [
      {
        say: { text: "Благодарю ! 🌹" },
        expect: {
          count: 1,
          says: [(c) => c.thanksReply],
          mails: [],
          sellerNotices: 0,
        },
      },
      { say: { text: "Спасибо большое!" }, expect: { silent: true, sellerNotices: 0 } },
    ],
  },
  ...everyLocale(() => ({
    id: "postpay-thanks-plain-word",
    title:
      "короткое «спасибо» после выдачи (раньше молча закрывало разговор) — тот же один ответ «Рада помочь»",
    origin:
      "Яков 11.10, решение 8б: на «спасибо/благодарю» после выдачи — «Рада помочь! Хороших уроков»",
    channel: "instagram",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [{ action: "thanks" }],
    arrange: paidOrder({ email: "anna@mail.ru" }),
    steps: [
      {
        say: { text: "Спасибо" },
        expect: { count: 1, says: [(c) => c.thanksReply], sellerNotices: 0 },
      },
    ],
  })),
  {
    id: "postpay-thanks-before-delivery-ig-ru",
    title:
      "«спасибо» пока чек проверяют — бот не отвечает «Рада помочь» (материалов ещё нет), обращения нет",
    origin: "ожидание к решению 8б Якова 11.10",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [{ action: "thanks" }],
    arrange: paidOrder({ email: "anna@mail.ru", status: "awaiting_confirmation" }),
    steps: [
      {
        say: { text: "Спасибо" },
        expect: { notSays: [(c) => c.thanksReply], sellerNotices: 0 },
      },
    ],
  },
  // ───── «Спасибо», эмодзи, «+» без обращения; оплата из страны без способа (Копилка 12.10) ─────
  {
    id: "triage-chatter-no-ticket-ig-ru",
    title:
      "«Благодарю! 🌹» и «🔥» без заказа — бот молчит, обращение не открывается; вопрос после них уходит продавцу обращением",
    origin:
      "Копилка 12.10, разбор 133 обращений: 22 обращения на «Благодарю! 🌹» (#123), «Браво!» (#116), «🔥» (#65), «Я подписан(а)»",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "chatter" }, { kind: "chatter" }, { kind: "other" }],
    steps: [
      { say: { text: "Благодарю! 🌹" }, expect: { silent: true, sellerNotices: 0 } },
      { say: { text: "🔥🔥" }, expect: { silent: true, sellerNotices: 0 } },
      {
        say: { text: "Есть папка МО русского языка?" },
        expect: { silent: true, sellerNotices: 1 },
      },
    ],
  },
  {
    id: "triage-chatter-switch-off-ig-ru",
    title:
      "«Не открывать обращение на «спасибо»» выключено — «Благодарю! 🌹» открывает обращение, как раньше",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "chatter" }],
    arrange: (r) => {
      r.db.tables.app_settings!.push({ key: "chat_skip_chatter", value: "false" });
    },
    steps: [{ say: { text: "Благодарю! 🌹" }, expect: { sellerNotices: 1 } }],
  },
  {
    id: "triage-foreign-pay-belarus-ig-ru",
    title:
      "«В бел. руб можно» — один ответ «оплату из вашей страны подключаем», вопрос продавцу обращением; второй такой вопрос — без повторного ответа",
    origin:
      "Копилка 12.10, обращение #118: кулик виктория «В бел. руб можно» — бот молчал, она ушла: «Жаль(спасибо.»",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [
      { kind: "foreign_pay", country: "BY" },
      { kind: "foreign_pay", country: "BY" },
    ],
    steps: [
      {
        say: { text: "В бел. руб можно" },
        expect: {
          count: 1,
          says: [(c) => c.foreignPayReply],
          notSays: ["Передал ваш вопрос продавцу", /Обращение #/],
          sellerNotices: 1,
        },
      },
      {
        say: { text: "А картой Беларусбанка можно оплатить?" },
        expect: { silent: true, sellerNotices: 0 },
      },
    ],
  },
  {
    id: "triage-foreign-pay-race-ig-ru",
    title:
      "два вопроса об оплате из Беларуси одновременно и повтор вебхука — ответ «оплату подключаем» уходит один раз",
    origin: "CLAUDE.md «Один раз»: двойная доставка, два сообщения подряд",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [
      { kind: "foreign_pay", country: "BY" },
      { kind: "foreign_pay", country: "BY" },
      { kind: "foreign_pay", country: "BY" },
    ],
    steps: [
      {
        say: { burst: ["В бел. руб можно", "Я из Минска"] },
        expect: { count: 1, says: [(c) => c.foreignPayReply] },
      },
      { say: { repeat: true }, expect: { silent: true } },
    ],
  },
  {
    id: "triage-foreign-pay-uzbekistan-strict-ig-ru",
    title:
      "«Только по заказам» (по умолчанию): «я из Узбекистана, как оплатить?» — бот отвечает «оплату подключаем», а не молчит",
    origin: "Копилка 12.10, обращения #122, #125 (Узбекистан): бот молчал, оплата мимо бота",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "foreign_pay", country: "UZ" }],
    steps: [
      {
        say: { text: "Здравствуйте, я из Узбекистана, как оплатить?" },
        expect: { count: 1, says: [(c) => c.foreignPayReply], sellerNotices: 1 },
      },
    ],
  },
  {
    id: "triage-foreign-pay-method-exists-ig-ru",
    title:
      "у магазина есть способ оплаты для Кыргызстана — «оплату подключаем» не пишем, вопрос идёт прежним путём",
    origin: "ожидание: ответ только для стран без способа оплаты",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "foreign_pay", country: "KG" }],
    arrange: (r) => {
      r.db.tables.payment_methods!.push({
        id: "pm-kg",
        bot_id: r.db.tables.payment_methods![0]!.bot_id,
        is_active: true,
        sort_order: 2,
        country_code: "KG",
        country_name: "Кыргызстан",
        currency: "KGS",
      });
    },
    steps: [
      {
        say: { text: "Можно посчитать в сомах?" },
        expect: { notSays: [(c) => c.foreignPayReply], sellerNotices: 1 },
      },
    ],
  },
  {
    id: "triage-foreign-pay-switch-off-ig-ru",
    title: "«Отвечать про оплату из других стран» выключено — бот не отвечает, вопрос продавцу",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "foreign_pay", country: "BY" }],
    arrange: (r) => {
      r.db.tables.app_settings!.push({ key: "chat_foreign_pay", value: "false" });
    },
    steps: [
      {
        say: { text: "В бел. руб можно" },
        expect: { notSays: [(c) => c.foreignPayReply], sellerNotices: 1 },
      },
    ],
  },
  // ───── Дневной срез AATeach 12.10: оплата и чеки в переписке (решения Якова 1–4) ─────
  {
    id: "pay-failed-photo-caption-ig-ru",
    title:
      "фото с подписью «Не проходит» — это скриншот ошибки: чек не принимается, «попробуйте ещё раз или напишите банк», заказ ждёт оплату",
    origin:
      "AATeach 12.10, kopats23 #1435 (Беларусь): фото и «Не проходит» → «✅ Чек получен», заказ 13 часов висел у Анастасии как оплаченный",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    triage: [{ kind: "payment_failed" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { photoWithText: "Не проходит" },
        expect: {
          count: 1,
          says: [(c) => c.payFailedReply],
          notSays: [(c) => c.proofReceivedNeedEmail(82), (c) => c.proofReceived(82)],
          orders: { 82: { status: "awaiting_payment" } },
        },
      },
    ],
  },
  {
    id: "pay-failed-after-photo-ig-ru",
    title:
      "фото, а следом «Не проходит» — чек снимается: заказ снова ждёт оплату, продавцу уведомление, покупателю «попробуйте ещё раз»",
    origin: "AATeach 12.10, kopats23 #1435: фото 18:27:06, «Не проходит» 18:27:09",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    triage: [{ kind: "payment_failed" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { photo: true },
        expect: {
          says: [(c) => c.proofReceivedNeedEmail(82)],
          orders: { 82: { status: "awaiting_confirmation" } },
        },
      },
      {
        say: { text: "Не проходит" },
        expect: {
          count: 1,
          says: [(c) => c.payFailedReply],
          sellerNotices: 1,
          state: { mode: "awaiting_proof" },
          orders: {
            82: {
              status: "awaiting_payment",
              admin_note: expect.stringContaining("Не проходит"),
            },
          },
        },
      },
    ],
  },
  {
    id: "pay-failed-same-time-ig-ru",
    title:
      "фото и «Не проходит» приходят почти одновременно и обрабатываются параллельно — заказ остаётся неоплаченным, «не прошёл» уходит один раз",
    origin:
      "AATeach 12.10, kopats23 #1435: два вебхука с разницей в 3 секунды, разбор шёл одновременно",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    mail: true,
    receipts: true,
    triage: [{ kind: "payment_failed" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { photos: 1, caption: "Не проходит" },
        expect: {
          says: [(c) => c.payFailedReply],
          orders: { 82: { status: "awaiting_payment" } },
        },
      },
    ],
  },
  {
    id: "pay-failed-switch-off-ig-ru",
    title:
      "«Не принимать чек, если платёж не прошёл» выключено — фото с подписью «Не проходит» принимается как чек, как раньше",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    triage: [{ kind: "payment_failed" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: (r) => {
      paidOrder({ status: "awaiting_payment" })(r);
      r.db.tables.app_settings!.push({ key: "chat_pay_failed", value: "false" });
    },
    steps: [
      {
        say: { photoWithText: "Не проходит" },
        expect: {
          says: [(c) => c.proofReceivedNeedEmail(82)],
          notSays: [(c) => c.payFailedReply],
          orders: { 82: { status: "awaiting_confirmation" } },
        },
      },
    ],
  },
  {
    id: "pay-ok-caption-ig-ru",
    title: "фото чека с подписью «Оплатила» — обычный чек: «Чек получен», заказ на подтверждение",
    origin: "граница к pay-failed-photo-caption-ig-ru",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    triage: [{ kind: "other" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { photoWithText: "Оплатила, вот чек" },
        expect: {
          says: [(c) => c.proofReceivedNeedEmail(82)],
          orders: { 82: { status: "awaiting_confirmation" } },
        },
      },
    ],
  },
  {
    id: "cant-send-receipt-ig-ru",
    title:
      "«Не получается отправить чек сюда» — бот предлагает прислать текст чека; «На ватсап можно?» после этого — продавцу, без второй подсказки; текст чека принимается",
    origin:
      "AATeach 12.10, asya_6465 #1437: «Не получается отправить чек сюда», «На ватсап можно?» — дважды инструкция про скрепку",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    triage: [{ kind: "cant_send_receipt" }, { kind: "cant_send_receipt" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { text: "Не получается отправить чек сюда" },
        expect: {
          count: 1,
          says: [(c) => c.receiptTextOffer],
          notSays: [(c) => c.receiptHowTo],
        },
      },
      {
        say: { text: "На ватсап можно?" },
        expect: { silent: true },
      },
      {
        say: { text: "Перевод выполнен\n189 ₽\nПолучатель: Анастасия А.\n№ операции 4405123987" },
        expect: {
          says: [EVENING_COPY.ru.textReceiptTaken(82)],
          orders: { 82: { status: "awaiting_confirmation", payment_proof_path: "Чек текстом" } },
        },
      },
    ],
  },
  {
    id: "cant-send-receipt-paid-ig-ru",
    title:
      "«Я закинула деньги, но скриншот не загружается сюда» — не тишина, а предложение прислать текст чека",
    origin: "AATeach 11.10 23:02, galinka.iva #1431 — бот промолчал",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    triage: [{ kind: "cant_send_receipt" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { text: "Я закинула деньги, но скриншот не загружается сюда." },
        expect: { count: 1, says: [(c) => c.receiptTextOffer] },
      },
    ],
  },
  {
    id: "cant-send-receipt-switch-off-ig-ru",
    title:
      "«Предлагать чек текстом» выключено — на «не получается отправить чек» бот, как раньше, объясняет, как прикрепить скриншот",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    triage: [{ kind: "cant_send_receipt" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: (r) => {
      paidOrder({ status: "awaiting_payment" })(r);
      r.db.tables.app_settings!.push({ key: "chat_receipt_text_offer", value: "false" });
    },
    steps: [
      {
        say: { text: "Не получается отправить чек сюда" },
        expect: { says: [(c) => c.receiptHowTo], notSays: [(c) => c.receiptTextOffer] },
      },
    ],
  },
  {
    id: "unpaid-number-ig-ru",
    title:
      "сразу после заказа «018» — не товар 018, а «Заказ #82 ждёт оплату, отменить — «Отмена»»; номер ещё раз — обычный путь к товару",
    origin:
      "AATeach 11.10 23:09, tskhay_sasha: после #1432 «3» → карточка товара 003, потом второй заказ #1434 на то же",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: { mode: "awaiting_payment", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { text: "018" },
        expect: { count: 1, says: [(c) => c.orderAwaitsPayment("82")], notSays: ["Прописи"] },
      },
      // Номер ещё раз — обычный путь к товару, без второго напоминания.
      { say: { text: "018" }, expect: { notSays: [(c) => c.orderAwaitsPayment("82")] } },
    ],
  },
  {
    id: "unpaid-number-switch-off-ig-ru",
    title:
      "«Номер товара сразу после заказа — сначала про заказ» выключено — номер сразу открывает товар",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: { mode: "awaiting_payment", pending_order_id: 82 },
    arrange: (r) => {
      paidOrder({ status: "awaiting_payment" })(r);
      r.db.tables.app_settings!.push({ key: "chat_unpaid_number", value: "false" });
    },
    steps: [
      {
        say: { text: "018" },
        expect: { notSays: [(c) => c.orderAwaitsPayment("82")] },
      },
    ],
  },
  {
    id: "resend-old-order-asks-ig-ru",
    title:
      "почта по заказу месячной давности — бот сначала спрашивает «прислать №82 от …?», письмо уходит только после «да»",
    origin:
      "AATeach 12.10 07:35, yekaterina3107: прислала почту, бот отправил сентябрьский заказ #955, а она ждала «Части речи»",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [{ action: "resend", email: "kate@mail.ru" }],
    arrange: paidOrder({ email: "kate@mail.ru", daysAgo: 32 }),
    steps: [
      {
        say: { text: "kate@mail.ru" },
        expect: {
          count: 1,
          says: ["№82", "Палитра средств выразительности", "kate@mail.ru"],
          mails: [],
          sellerNotices: 0,
        },
      },
      {
        say: { text: "да" },
        expect: { says: ["Отправил материалы на kate@mail.ru"], mails: ["kate@mail.ru"] },
      },
    ],
  },
  {
    id: "stale-email-step-empty-cart-ig-ru",
    title:
      "шаг «почта перед заказом» остался с прошлого месяца, корзина пуста — на адрес не «Корзина пуста», а вопрос о старом заказе",
    origin:
      "AATeach 12.10 16:25, lady_brown_hair_pp: не успела скачать «Состав слова» (#1160 от 24.09), прислала почту — бот: «🛒 Корзина пуста.»",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    mail: true,
    state: { mode: "awaiting_email", country_code: "RU" },
    postpay: [{ action: "resend", email: "kitten@mail.ru" }],
    arrange: paidOrder({ email: "old@mail.ru", daysAgo: 18 }),
    steps: [
      {
        say: { text: "kitten@mail.ru" },
        expect: {
          says: ["№82", "kitten@mail.ru"],
          notSays: [(c) => c.cartEmpty],
          mails: [],
        },
      },
    ],
  },
  {
    id: "resend-old-order-switch-off-ig-ru",
    title:
      "«Спрашивать перед повторной отправкой» выключено — письмо по старому заказу уходит сразу, как раньше",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [{ action: "resend", email: "kate@mail.ru" }],
    arrange: (r) => {
      paidOrder({ email: "kate@mail.ru", daysAgo: 32 })(r);
      r.db.tables.app_settings!.push({ key: "resend_old_confirm", value: "false" });
    },
    steps: [
      {
        say: { text: "kate@mail.ru" },
        expect: { says: ["Отправил материалы на kate@mail.ru"], mails: ["kate@mail.ru"] },
      },
    ],
  },
  // ───── Почта после чека — настройка продавца (Кристина 10.10: «удобно, когда сразу в инстаграм») ─────
  {
    id: "receipt-asks-email-ig-ru",
    title: "по умолчанию после чека бот спрашивает почту для копии материалов",
    origin: "ожидание к receipt-no-email-ask-ig-ru",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { photo: true },
        expect: {
          says: [(c) => c.proofReceivedNeedEmail(82)],
          state: { mode: "awaiting_order_email" },
        },
      },
    ],
  },
  {
    id: "receipt-payment-failed-ig-ru",
    title:
      "фото с ошибкой платежа и «Не проходит» — бот не пишет «чек получен», просит чек успешной оплаты, заказ ждёт оплату",
    origin:
      "AATeach 11.10 23:27, kopats23 (#1435, Беларусь, 7 BYN): фото и «Не проходит» → «✅ Чек по заказу получен», заказ 13 часов у продавца как оплаченный",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    receipts: true,
    receiptAi: [
      {
        is_receipt: true,
        status: "failed",
        amount: 1700,
        currency: "KZT",
        edit_signs: [],
        text: "Перевод\n1 700 ₸\nОперация отклонена банком",
      },
    ],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { photo: true },
        expect: {
          says: [(c) => c.receiptPaymentFailed("82")],
          notSays: [(c) => c.proofReceived(82), (c) => c.proofReceivedNeedEmail(82)],
          orders: { 82: { status: "awaiting_payment" } },
          sellerNotices: 0,
        },
      },
    ],
  },
  {
    id: "receipt-matched-hint-ig-ru",
    title:
      "чек совпал — покупателю обычное «чек получен», продавцу «✅ Чек совпал», заказ сам не выдаётся (выдача сразу выключена)",
    origin: "Яков 12.10: проверка чеков без банка; продавец по-прежнему подтверждает кнопкой",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    receipts: true,
    mail: true,
    receiptAi: [
      {
        is_receipt: true,
        status: "success",
        amount: 1700,
        currency: "KZT",
        operation_id: "123456789",
        edit_signs: [],
        text: "Kaspi\nПеревод успешно выполнен\nСумма 1 700 ₸\nКвитанция № 123456789",
      },
    ],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { photo: true },
        expect: {
          says: [(c) => c.proofReceivedNeedEmail(82)],
          notSays: [(c) => c.receiptVerified("82")],
          orders: {
            82: {
              status: "awaiting_confirmation",
              admin_note:
                "OCR: ✅ Чек совпал с заказом: 1700 KZT, № 123456789. Повтора нет. Проверьте поступление в банке и подтвердите заказ.",
            },
          },
        },
      },
    ],
  },
  {
    id: "receipt-no-email-ask-ig-ru",
    title:
      "продавец выключил «спрашивать почту»: после чека бот почту не спрашивает, материалы — в переписку",
    origin:
      "Кристина (Копилка) 10.10 11:03: «может с почтой не стоит заморачиваться? удобно, когда выдаёт материал сразу в инстаграм»",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: (r) => {
      paidOrder({ status: "awaiting_payment" })(r);
      r.db.tables.app_settings!.push({ key: "chat_email_ask", value: "false" });
    },
    steps: [
      {
        say: { photo: true },
        expect: {
          says: [(c) => c.proofReceived(82)],
          notSays: [(c) => c.proofReceivedNeedEmail(82)],
          state: { mode: "idle" },
        },
      },
    ],
  },
  {
    id: "email-as-photo-ig-ru",
    title:
      "на вопрос о почте покупатель шлёт скриншот с адресом: бот один раз просит написать почту текстом и ждёт адрес дальше",
    origin:
      "Анастасия (AATeach) 11.10 20:32: «Фотографии, скриншоты и изображения с адресом электронной почты НЕ ПРИНИМАЮТСЯ»; kalieva6631 #1417 прислала скриншот почты, бот промолчал",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { photo: true },
        expect: {
          says: [(c) => c.proofReceivedNeedEmail(82)],
          state: { mode: "awaiting_order_email" },
        },
      },
      {
        say: { photo: true },
        expect: {
          count: 1,
          says: [(c) => c.emailTextOnly],
          sellerNotices: 0,
          state: { mode: "awaiting_order_email" },
        },
      },
      { say: { photo: true }, expect: { silent: true, sellerNotices: 0 } },
    ],
  },
  // ───── Вечерний срез AATeach 11.10: почта по желанию, чек текстом ─────
  {
    id: "email-optional-whatsapp-ig-ru",
    title:
      "на вопрос о почте «Вацап отправте»: бот один раз говорит, что файлы придут сюда, и почту больше не спрашивает",
    origin:
      "AATeach 11.10 вечер: kalieva6631 #1417 «Вацап отправте» → «Напишите почту» дважды; olga2562524 #1402, ryskul_kussainova #1400 «А в инстаграм можно отправить?»",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    postpay: [{ action: "status" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { photo: true },
        expect: {
          says: [(c) => c.proofReceivedNeedEmail(82)],
          state: { mode: "awaiting_order_email" },
        },
      },
      {
        say: { text: "Вацап отправте" },
        expect: {
          count: 1,
          says: [EVENING_COPY.ru.filesHere],
          notSays: [(c) => c.emailHint],
          state: { mode: "idle" },
        },
      },
      {
        say: { text: "Отправьте материал, который оплатила" },
        expect: { notSays: [EVENING_COPY.ru.filesHere, "почт"] },
      },
    ],
  },
  {
    id: "email-optional-off-ig-ru",
    title: "продавец выключил «Почта по желанию»: на «вацап» бот не обещает файлы в переписке",
    origin: "переключатель к email-optional-whatsapp-ig-ru (Яков 11.10: «1 и 2 — переключатели»)",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: (r) => {
      paidOrder({ status: "awaiting_payment" })(r);
      r.db.tables.app_settings!.push({ key: "chat_email_optional", value: "false" });
    },
    steps: [
      { say: { photo: true }, expect: { state: { mode: "awaiting_order_email" } } },
      {
        say: { text: "Вацап отправте" },
        expect: { notSays: [EVENING_COPY.ru.filesHere], state: { mode: "idle" } },
      },
    ],
  },
  {
    id: "email-typo-ig-ru",
    title: "почта без «@» («anna mail.ru») на вопрос о почте — подсказка с примером, а не тишина",
    origin: "AATeach 11.10 вечер: адрес с опечаткой — бот промолчал (Яков, пункт 4в)",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      { say: { photo: true }, expect: { state: { mode: "awaiting_order_email" } } },
      {
        say: { text: "anna mail.ru" },
        expect: {
          count: 1,
          says: [(c) => c.emailHint],
          state: { mode: "awaiting_order_email" },
        },
      },
      {
        say: { text: "anna@mail.ru" },
        expect: { says: ["anna@mail.ru"], state: { mode: "idle" } },
      },
    ],
  },
  {
    id: "receipt-as-text-ig-ru",
    title:
      "Kaspi не даёт скриншот, покупатель вставляет текст чека: «Принял чек, передаю на проверку», заказ — продавцу",
    origin:
      "AATeach 11.10: lastochkina_olga73 #1391 «скрин каспи не даёт сделать» + «Оплата совершена 800 ₸ … № чека QR18040511543» — бот молчал, заказ висел",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: {
          text: "Оплата совершена\n800 ₸\nПолучатель: ИП Анастасия\n№ чека QR18040511543\n11.10.2026 11:49",
        },
        expect: {
          says: [EVENING_COPY.ru.textReceiptTaken(82)],
          state: { mode: "idle" },
          orders: {
            82: {
              status: "awaiting_confirmation",
              payment_proof_path: "Чек текстом",
              admin_note: expect.stringContaining("QR18040511543"),
            },
          },
        },
      },
    ],
  },
  {
    id: "receipt-as-text-off-ig-ru",
    title: "продавец выключил «Принимать чек текстом»: текст чека — не чек, бот его не принимает",
    origin: "переключатель к receipt-as-text-ig-ru (Яков 11.10: «1 и 2 — переключатели»)",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: (r) => {
      paidOrder({ status: "awaiting_payment" })(r);
      r.db.tables.app_settings!.push({ key: "chat_receipt_text", value: "false" });
    },
    steps: [
      {
        say: {
          text: "Оплата совершена\n800 ₸\nПолучатель: ИП Анастасия\n№ чека QR18040511543\n11.10.2026 11:49",
        },
        expect: {
          notSays: [EVENING_COPY.ru.textReceiptTaken(82)],
          state: { mode: "awaiting_proof" },
          orders: { 82: { status: "awaiting_payment" } },
        },
      },
    ],
  },
  {
    id: "paid-report-not-text-receipt-ig-ru",
    title: "«Я оплатила 800 тг» — рассказ, а не чек: бот по-прежнему просит скриншот",
    origin: "граница к receipt-as-text-ig-ru",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { text: "Я оплатила 800 тг" },
        expect: {
          notSays: [EVENING_COPY.ru.textReceiptTaken(82)],
          state: { mode: "awaiting_proof" },
        },
      },
    ],
  },
  {
    id: "locale-in-words-ig-ru",
    title: "на вопрос о языке «На русском» — выбор языка, а не повтор вопроса",
    origin: "AATeach 11.10 вечер: dubovets.oksana «На русском» → вопрос о языке повторён",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: { mode: "awaiting_locale", direct: { last_reply_at: new Date().toISOString() } },
    steps: [
      {
        say: { text: "На русском" },
        expect: { says: [(c) => c.languageSaved], state: { mode: "idle", locale: "ru" } },
      },
    ],
  },
  // ───── Телефон не коды товаров (Б2, скрин Якова 04.10) ─────
  ...everyLocale(
    () => ({
      id: "phone",
      title:
        "номер телефона записывается, а не превращается в коды товаров; бот молчит, продавцу — уведомление",
      origin:
        "Б2, скрин Якова 04.10; жалоба продавца 08.10: «Записал ваш номер» делал переписку прочитанной",
      channel: "instagram",
      products: PRODUCTS,
      steps: [
        {
          say: { text: PHONE },
          expect: {
            silent: true,
            sellerNotices: 1,
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
    title: "тот же номер дважды (двойная доставка вебхука) — одно уведомление продавцу",
    origin: "Б2",
    channel: "whatsapp",
    locale: "ru",
    products: PRODUCTS,
    steps: [
      { say: { text: PHONE }, expect: { silent: true, sellerNotices: 1 } },
      { say: { repeat: true }, expect: { silent: true, sellerNotices: 0 } },
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
  // ───── Кнопка «Купить» второго сообщения автоматизации ─────
  {
    id: "two-step-buy-long-description-ig-ru",
    title:
      "кнопка «Купить» (PROD:…) у товара с длинным описанием — ответ уходит: сразу заказ с оплатой",
    origin:
      "Копилка русоведа 09.10 14:03: «Палитра», описание 1067 знаков — карточка длиннее 640 с кнопками отклонялась, «Купить» молчал",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: [{ id: P1, name: "Палитра средств выразительности", description: LONG_DESC }],
    state: {},
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { count: 1, says: ["Палитра средств выразительности", "К оплате"] },
      },
    ],
  },
  {
    id: "two-step-buy-express-ig-ru",
    title:
      "«Купить» из автоматизации — сразу заказ: одно сообщение с товаром, суммой и способом оплаты, без корзины; повторное нажатие — «уже оформлен» один раз, дальше тишина; «Отмена» сразу после — заказ отменён",
    origin:
      "Копилка русоведа 09.10 17:05: «Купить» → корзина → «Оформить заказ» → оплата; ~80 обращений, ни одной оплаты, «они путаются» (в BotHelp было два шага)",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    state: {},
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: {
          count: 1,
          says: ["Палитра средств выразительности", "К оплате"],
          notSays: ["Ваша корзина", "Добавлено в корзину"],
          noButtons: ["✅ Оформить заказ", "➕ Добавить в корзину"],
          cart: 0,
          state: { mode: "awaiting_proof" },
        },
      },
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: {
          count: 1,
          says: [/Заказ #\d+ уже оформлен — реквизиты в сообщении выше/],
          notSays: ["Ваша корзина", "К оплате"],
          cart: 0,
          state: { mode: "awaiting_proof" },
        },
      },
      // zuxra6163 нажала «Купить» 8 раз за 3 минуты и получила 8 «Заказ #1415 оформлен» (AATeach 11.10).
      { say: { button: `PROD:${P1}`, title: "Купить" }, expect: { silent: true } },
      { say: { button: `PROD:${P1}`, title: "Купить" }, expect: { silent: true } },
      {
        say: { text: "Отмена" },
        expect: { count: 1, says: [/Заказ #\d+ отменён/], state: { mode: "idle" } },
      },
    ],
  },
  {
    id: "repeat-buy-concurrent-ig-ru",
    title:
      "«Купить» нажато четыре раза одновременно по уже оформленному заказу — один ответ «уже оформлен»",
    origin:
      "AATeach 11.10 18:03–18:06: zuxra6163, 8 нажатий «Купить» → 8 сообщений «Заказ #1415 оформлен»",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: [{ id: P1, name: "Комплект ко Дню хлеба" }],
    state: {},
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { count: 1, says: ["К оплате"], state: { mode: "awaiting_proof" } },
      },
      {
        say: { clicks: 4, button: `PROD:${P1}`, title: "Купить" },
        expect: { count: 1, says: ["уже оформлен"], notSays: ["К оплате"] },
      },
    ],
  },
  {
    id: "express-pay-card-send-failed-ig-ru",
    title:
      "«Купить» — заказ оформлен, а сообщение с оплатой Zernio не принял: продавцу одно уведомление «напишите сами», повтор «Купить» нового не шлёт",
    origin:
      "Копилка 14.10 13:00, gulnarbeisembina #217: вопрос о цене, через 20 с «Купить» → заказ создан, карточки с оплатой нет, отказ только в логе функции (№69)",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    state: {},
    sendFails: true,
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { sellerNotices: 1, state: { mode: "awaiting_proof" } },
      },
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { sellerNotices: 0, state: { mode: "awaiting_proof" } },
      },
    ],
  },
  {
    id: "express-pay-choice-send-failed-ig-ru",
    title:
      "«Купить» при Продамусе и Kaspi — выбор оплаты не ушёл: заказ ждёт выбора, продавцу одно уведомление",
    origin:
      "Копилка 14.10 13:00, gulnarbeisembina #217: заказ на шаге выбора оплаты, сообщение с кнопками не дошло, продавец не знал (№69)",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    sendFails: true,
    arrange: (r) => {
      r.db.tables.app_settings!.push(
        { key: "prodamus_enabled", value: "true" },
        { key: "prodamus_form_url", value: "https://kopilka.proeducation.kz" },
        { key: "prodamus_secret_key", value: "k".repeat(64) },
        { key: "prodamus_currency", value: "KZT" },
      );
    },
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { sellerNotices: 1, state: { mode: "choose_pay" } },
      },
    ],
  },
  {
    id: "two-step-buy-express-prodamus-ig-ru",
    title:
      "«Купить» при кассе Продамуса и Kaspi — одно сообщение: товар, сумма, «Картой онлайн» и «Перевод Kaspi»",
    origin:
      "Копилка русоведа 09.10 17:11: «Выбирают страну, там цена и способ оплаты» — без корзины и «Оформить заказ»",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    arrange: (r) => {
      r.db.tables.app_settings!.push(
        { key: "prodamus_enabled", value: "true" },
        { key: "prodamus_form_url", value: "https://kopilka.proeducation.kz" },
        { key: "prodamus_secret_key", value: "k".repeat(64) },
        { key: "prodamus_currency", value: "KZT" },
      );
      r.db.tables.payment_methods![0]!.instructions = "Kaspi Gold 4400 0000 0000 0000, Кристина К.";
    },
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: {
          count: 1,
          says: ["Палитра средств выразительности", "К оплате", (c) => c.cardAnyCountryLine],
          buttons: [COPY.ru.payByCardBtn, COPY.ru.payKaspiBtn],
          noButtons: ["✅ Оформить заказ"],
          state: { mode: "choose_pay" },
        },
      },
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { count: 1, buttons: [COPY.ru.payByCardBtn], state: { mode: "choose_pay" } },
      },
    ],
  },
  {
    id: "pay-amount-rub-price-ig-ru",
    title: "«К оплате: 1700 ₸ / 470 ₽» — рублёвая цена товара рядом с тенге",
    origin:
      "Копилка русоведа 10.10 09:32: «где «к оплате 1700» добавить через слеш сумму в рублях — некоторые думают, что это в рублях»",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    arrange: (r) => {
      r.db.tables.app_settings!.push(
        { key: "prodamus_enabled", value: "true" },
        { key: "prodamus_form_url", value: "https://kopilka.proeducation.kz" },
        { key: "prodamus_secret_key", value: "k".repeat(64) },
        { key: "prodamus_rate", value: "3.573" },
      );
      for (const p of r.db.tables.products!) p.country_prices = { KZ: 1700, RU: 470 };
    },
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { count: 1, says: ["К оплате: 1700 ₸ / ≈470 ₽"], state: { mode: "choose_pay" } },
      },
    ],
  },
  {
    id: "pay-amount-rub-by-rate-ig-ru",
    title:
      "без рублёвой цены у товара — только тенге, по курсу Продамуса не пересчитываем (Яков, 10.10)",
    origin:
      "Копилка русоведа 10.10 09:32: «где «к оплате 1700» добавить через слеш сумму в рублях — некоторые думают, что это в рублях»",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    arrange: (r) => {
      r.db.tables.app_settings!.push(
        { key: "prodamus_enabled", value: "true" },
        { key: "prodamus_form_url", value: "https://kopilka.proeducation.kz" },
        { key: "prodamus_secret_key", value: "k".repeat(64) },
        { key: "prodamus_rate", value: "3.573" },
      );
    },
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: {
          count: 1,
          says: ["К оплате: 1700 ₸\n"],
          notSays: ["₽"],
          state: { mode: "choose_pay" },
        },
      },
    ],
  },
  {
    id: "two-step-buy-express-off-ig-ru",
    title: "быстрая покупка выключена продавцом — «Купить» кладёт в корзину, как раньше",
    origin: "настройка «быстрая покупка по автоматизации» (09.10): выключенная не меняет сценарий",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    arrange: noExpress,
    state: {},
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: {
          count: 1,
          says: ["Добавлено в корзину", "Ваша корзина"],
          buttons: ["✅ Оформить заказ"],
          cart: 1,
        },
      },
    ],
  },
  // ───── Оформление в Direct (Копилка 09.10 15:44, «идёт слив заявок») ─────
  {
    id: "checkout-single-country-ig-ru",
    title: "одна страна оплаты — «Оформить заказ» не спрашивает страну, а идёт дальше",
    origin:
      "Копилка русоведа 09.10 15:44: «Оформить заказ» → «Выберите страну оплаты: 1. Казахстан» → «Россия» → по кругу",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    state: { country_code: null, country_name: null },
    arrange: noExpress,
    steps: [
      { say: { button: `PROD:${P1}`, title: "Купить" }, expect: { cart: 1 } },
      {
        say: { button: "CHECKOUT", title: "✅ Оформить заказ" },
        expect: { notSays: ["Выберите страну"], state: { country_code: "KZ" } },
      },
    ],
  },
  {
    id: "checkout-kaspi-card-buttons-ig-ru",
    title:
      "касса в тенге и реквизиты Kaspi — кнопки «Картой онлайн» и «Перевод Kaspi», без «Карта РФ / СБП»",
    origin:
      "Копилка русоведа 09.10 15:43: «Оплата на каспи?» — покупатель не понял, какая кнопка для Kaspi",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    arrange: (r) => {
      noExpress(r);
      r.db.tables.app_settings!.push(
        { key: "prodamus_enabled", value: "true" },
        { key: "prodamus_form_url", value: "https://kopilka.proeducation.kz" },
        { key: "prodamus_secret_key", value: "k".repeat(64) },
        { key: "prodamus_currency", value: "KZT" },
      );
      r.db.tables.payment_methods![0]!.instructions = "Kaspi Gold 4400 0000 0000 0000, Кристина К.";
    },
    steps: [
      { say: { button: `PROD:${P1}`, title: "Купить" }, expect: { cart: 1 } },
      {
        say: { button: "CHECKOUT", title: "✅ Оформить заказ" },
        expect: {
          buttons: [COPY.ru.payByCardBtn, COPY.ru.payKaspiBtn],
          noButtons: [COPY.ru.payViaProdamusBtn, COPY.ru.payManualBtn],
        },
      },
    ],
  },
  {
    id: "kaspi-link-as-button-ig-ru",
    title: "реквизиты — ссылка pay.kaspi.kz: ссылка и кнопкой, и текстом",
    origin:
      "Копилка русоведа 09.10 19:01–19:18: «Перевод Kaspi» жали по три раза, «Не нажимается», «Как оплатить» — ссылка была только текстом",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    arrange: (r) => {
      noExpress(r);
      r.db.tables.payment_methods![0]!.instructions = "https://pay.kaspi.kz/pay/fpf1rhkt";
    },
    steps: [
      { say: { button: `PROD:${P1}`, title: "Купить" }, expect: { cart: 1 } },
      {
        // Kaspi — единственный способ: «Оформить заказ» сразу присылает реквизиты.
        say: { button: "CHECKOUT", title: "✅ Оформить заказ" },
        expect: {
          buttons: [COPY.ru.payLinkBtn(true)],
          says: ["https://pay.kaspi.kz/pay/fpf1rhkt", "скопируйте ссылку", "чека"],
        },
      },
    ],
  },
  {
    id: "checkout-email-words-skip-ig-ru",
    title: "на шаге «почта» пишут не адрес — бот идёт к оплате без почты, а не по кругу",
    origin:
      "Копилка русоведа 09.10 15:43: «Можете на почту», «Оплата на каспи?» — «Это не похоже на адрес почты» по кругу",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    state: {
      mode: "awaiting_email",
      direct: { last_reply: "Почта", last_reply_at: new Date().toISOString() },
    },
    steps: [
      {
        say: { text: "Оплата на каспи?" },
        expect: { notSays: ["не похоже на адрес"], state: { mode: "idle" } },
      },
    ],
  },
  // ───── Цены во всех валютах оплаты (Яков 09.10: «1500т / 300р») ─────
  {
    id: "all-prices-pay-step-ig-ru",
    title:
      "цены во всех валютах — карточка «1500 ₸ / 490 ₽», страну спрашивают на оплате с суммами",
    origin:
      "Яков 09.10 16:17: «показывать не одну цену, а 2 — 1500т/300р, а при оплате через Kaspi 1500, через РФ 300р»",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, multi_currency: true },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    // Покупатель прошлого заказа: страна Казахстан поставилась сама, пока страна была одна.
    state: { country_code: "KZ", country_name: "Казахстан" },
    arrange: allPrices,
    steps: [
      { say: { button: "CATALOG", title: "📚 Каталог" }, expect: {} },
      { say: { text: "1" }, expect: { says: ["1500 ₸ / 490 ₽"] } },
      { say: { button: `BUY:${P1}`, title: "Купить" }, expect: { cart: 1 } },
      {
        say: { button: "CHECKOUT", title: "✅ Оформить заказ" },
        expect: {
          says: [(c) => c.choosePayCountry, "Казахстан — 1500 ₸", "Россия — 490 ₽"],
          state: { mode: "awaiting_country", pay_choice_pending: true },
        },
      },
      {
        say: { text: "2" },
        expect: { says: ["490 ₽"], notSays: ["1500 ₸"], state: { country_code: "RU" } },
      },
    ],
  },
  {
    id: "all-prices-card-tg-ru",
    title: "цены во всех валютах — карточка в Telegram показывает обе цены, без вопроса о стране",
    origin: "Яков 09.10 16:17: «1500т/300р»",
    channel: "telegram",
    locale: "ru",
    modules: { multi_currency: true },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    state: { country_code: null, country_name: null },
    arrange: allPrices,
    steps: [
      {
        say: { button: `prod:${P1}` },
        expect: { says: ["1500 ₸ / 490 ₽"], notSays: [(c) => c.chooseCountry] },
      },
    ],
  },
  // ───── Ответ словами на список «напишите номер» ─────
  {
    id: "list-words-hint-once-ig-ru",
    title:
      "после списка написал словами, а не номером — одна подсказка про номер, дальше реплика продавцу",
    origin:
      "Копилка русоведа 09.10 14:51: на «Напишите номер раздела» — «Классный руководитель и руссовед», бот промолчал",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: PRODUCTS,
    steps: [
      { say: { text: "каталог" }, expect: { says: ["018. Прописи"] } },
      {
        say: { text: "Классный руководитель и руссовед" },
        expect: { count: 1, says: ["напишите номер из списка"] },
      },
      {
        say: { text: "Классный руководитель и руссовед" },
        expect: { notSays: ["напишите номер из списка"] },
      },
      { say: { text: "1" }, expect: { says: ["018. Прописи"] } },
    ],
  },
  {
    id: "list-words-hint-burst-ig-ru",
    title: "после списка три реплики словами разом — подсказка про номер одна, а не три",
    origin:
      "AATeach 12.10 15:23 dusembina_irina: «Напишите пожалуйста точно цену», «Оформление на доску», «Не понятно» — три одинаковых «напишите номер из списка»",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: PRODUCTS,
    steps: [
      { say: { text: "каталог" }, expect: { says: ["018. Прописи"] } },
      {
        say: { burst: ["Напишите пожалуйста точно цену", "Оформление на доску", "Не понятно"] },
        expect: {
          says: ["напишите номер из списка"],
          notSays: [/номер из списка[\s\S]*номер из списка/],
        },
      },
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
    id: "how-to-buy-shows-catalog-ig-ru",
    title: "«Как купить?» ответом на сторис — каталог, а не молчание до продавца",
    origin:
      "обращение #77 Копилки русоведа 09.10: «Как купить?» ответом на сторис ушло менеджеру, бот промолчал",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: PRODUCTS,
    steps: [{ say: { text: "Как купить?" }, expect: { says: ["018. Прописи"] } }],
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
    title: "ответ на номер включён: реплика продавца старше 30 минут — бот снова отвечает",
    origin: "Б3",
    channel: "instagram",
    locale: "ru",
    arrange: (r) => {
      r.db.tables.app_settings!.push({ key: "chat_phone_reply", value: "true" });
      r.sellerTyped(45);
    },
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
    id: "checkout-no-phone-digital-tg-ru",
    title: "цифровой заказ в Telegram — без шага телефона, сразу к оплате",
    origin:
      "AATeach 15.10 00:24 «^»: на просьбу телефона «нет», «нет тиелефона», «000» — трижды «неверный номер», заказа нет",
    channel: "telegram",
    locale: "ru",
    products: PRODUCTS,
    steps: [
      { say: { button: `add:${PRODUCTS[0]!.id}` }, expect: { cart: 1 } },
      {
        say: { button: "checkout" },
        expect: { notSays: [(c) => c.phonePromptHtml] },
      },
    ],
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
  ...everyLocale(
    (l) => ({
      id: "consultant-instruction-telegram",
      title: "консультант в Telegram: «📖 Инструкция» зовёт писать сюда, а не в Direct",
      origin: "BOVI 08.10, партия 4: инструкция в Telegram говорила «Напишите запрос в Direct»",
      channel: "telegram",
      vertical: "consultant",
      modules: { shop: true },
      consultant: CONSULTANT_SAYS,
      steps: [
        {
          say: { text: COPY[l].instruction },
          expect: { says: ["📖"], notSays: [/Direct/i, CONSULTANT_SAYS], count: 1 },
        },
      ],
    }),
    ["telegram"],
  ),
  ...everyLocale(
    (l) => ({
      id: "consultant-universal-instruction-telegram",
      title: "универсальный консультант в Telegram: «📖 Инструкция» без «в Direct»",
      origin: "BOVI 08.10, партия 4: та же строка у ниши «Универсальный консультант»",
      channel: "telegram",
      vertical: "consultant_universal",
      modules: { shop: true },
      consultant: CONSULTANT_SAYS,
      steps: [
        {
          say: { text: COPY[l].instruction },
          expect: { says: ["📖"], notSays: [/Direct/i, CONSULTANT_SAYS], count: 1 },
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
  // ───── Добор пропущенных входящих: вебхук Zernio не пришёл (08.10) ─────
  ...everyLocale(
    () => ({
      id: "inbox-poll-missed-webhook",
      title:
        "вебхук не пришёл — опрос ящика отвечает один раз; поздний вебхук о том же сообщении молчит",
      origin:
        "BOVI 08.10, разбор v3 (партия 2, п. 6): без вебхука покупатель без ответа; v1 inbox-poll 23.09 — два ответа на один вопрос",
      channel: "instagram",
      full: true,
      vertical: "consultant",
      modules: { shop: true },
      consultant: CONSULTANT_SAYS,
      steps: [
        { say: { missed: "Есть кирпич М150?" }, expect: { says: [CONSULTANT_SAYS], count: 1 } },
        { say: { lateWebhook: true }, expect: { silent: true } },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
  ...everyLocale(
    () => ({
      id: "inbox-poll-mongo-ids",
      title:
        "список Zernio даёт _id, вебхук — свой id: поздний вебхук того же сообщения всё равно молчит",
      origin:
        "BOVI 08.10, сверка v3 после #576 (риск R2): совпадение id сообщения в списке и в вебхуке не подтверждено — общий только id Meta",
      channel: "instagram",
      full: true,
      vertical: "consultant",
      modules: { shop: true },
      consultant: CONSULTANT_SAYS,
      steps: [
        {
          say: { missed: "Есть кирпич М150?", mongoIds: true },
          expect: { says: [CONSULTANT_SAYS], count: 1 },
        },
        { say: { lateWebhook: true }, expect: { silent: true } },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
  ...everyLocale(
    (l) => ({
      id: "consultant-stuck-turn-handoff",
      title:
        "прошлый ход завис дольше ожидания — покупателю «передаю менеджеру», продавцу задача, а не тишина",
      origin:
        "BOVI 08.10, сверка v3 после #576 (риск R3): не дождавшееся хода сообщение оставалось без ответа и без задачи",
      channel: "instagram",
      full: true,
      vertical: "consultant",
      modules: { shop: true },
      pricelist: { catalog: PL_CATALOG, rounds: [said("Да, полотенца Uchino есть.")] },
      steps: [
        {
          say: { stuck: "Есть полотенца?" },
          expect: {
            says: [handoffReply(l)],
            notSays: [/Uchino/],
            count: 1,
            tasks: [{ done: false }],
          },
        },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
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
    id: "pricelist-tool-markup-never-sent-ig-ru",
    title: "модель написала вызов поиска текстом — покупателю не разметка, а передача менеджеру",
    origin:
      'BOVI 30.09: покупатель из ЯНАО получил «<invoke name="search_products">…» вместо ответа',
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        said(
          '<invoke name="search_products">\n<parameter name="query">Kleen Crystal</parameter>\n</invoke>',
        ),
        said(
          '<invoke name="search_products">\n<parameter name="query">Kleen Crystal</parameter>\n</invoke>',
        ),
      ],
    },
    steps: [
      {
        say: { text: "Есть такой коврик?" },
        expect: { says: [pricelistHandoffReply("ru")], notSays: [/invoke|parameter/], count: 1 },
      },
    ],
  },
  {
    id: "pricelist-no-third-clarification-ig-ru",
    title:
      "уже переспросили, а модель снова уточняет без поиска — черновик не уходит, покупатель получает варианты с ценой",
    origin:
      "BOVI 12.10 20:16, anjellaakaeva: «этот комплект?», фото, «в полуторном», «155*200» — четыре уточнения подряд, ни одного поиска и цены",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: [
        ...PL_CATALOG,
        {
          id: "B1",
          name: "Rivolta постельное бельё Fiori сатин",
          category: "Постельное бельё",
          size: "155x200",
          colors: ["молочный"],
          price_kzt: 45000,
          stock: true,
        },
      ],
      rounds: [
        said("Здравствуйте. Что подсказать?"),
        said("Уточните, пожалуйста, название комплекта?"),
        said("Уточните, пожалуйста, марку комплекта?"),
        [
          {
            type: "tool_use",
            id: "s1",
            name: "search_products",
            input: { query: "постельное бельё 155x200" },
          },
        ],
        said("Rivolta Fiori 155x200, молочный — 45 000 ₸. Показать другие расцветки?"),
      ],
    },
    steps: [
      { say: { text: "Здравствуйте" }, expect: { count: 1 } },
      { say: { text: "У вас есть в наличии этот комплект?" }, expect: { count: 1 } },
      {
        say: { text: "155*200" },
        expect: { says: ["45 000 ₸"], notSays: [/марку/], count: 1 },
      },
    ],
  },
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
    id: "pricelist-catalog-read-error",
    title: "прайс не прочитался (ошибка базы) — не «такого нет», а «не могу ответить» и передача",
    origin: "разбор BOVI 08.10: мягкое чтение отдавало пустой прайс, и он 45 с лежал в кэше",
    channel: "instagram",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: { catalog: PL_CATALOG, rounds: [said("Такого товара сейчас нет.")] },
    arrange: errorSettingRead("consultant_catalog_json"),
    steps: [
      {
        say: { text: "Есть полотенца Uchino?" },
        expect: { says: [unavailableReply(l)], notSays: ["нет."], sellerNotices: 1 },
      },
    ],
  })),
  ...everyLocale((l) => ({
    id: "pricelist-interim-phrase-limited",
    title:
      "модель сказала «Сейчас посмотрю…» и упёрлась в лимит — покупателю передача, не обещание",
    origin: "разбор BOVI 08.10: pricelist/engine.server — late/limited после поиска",
    channel: "instagram",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        [
          { type: "text", text: "Сейчас посмотрю наличие." },
          {
            type: "tool_use",
            id: "s1",
            name: "search_products",
            input: { query: "полотенца" },
          },
        ],
        said("Uchino полотенце банное 50х100 - 9 000 ₸."),
      ],
    },
    arrange: oneAiCallLeft,
    steps: [
      {
        say: { text: "Есть полотенца?" },
        expect: {
          says: [pricelistHandoffReply(l)],
          notSays: ["посмотрю"],
          sellerNotices: 1,
          paused: true,
        },
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
    id: "pricelist-short-answer-price-last-try-ig-ru",
    title:
      "короткий ответ «200/220»: цена дважды не по прайсу — модель отвечает без неё, не передача",
    origin:
      "BOVI 19–25.10, срез 25.10: на «200/220», «Белый», «Не темные» — «Передам ваш вопрос менеджеру» (fix:draft_again:price), хотя товар найден",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        said("Uchino полотенце банное 50х100 - 5 000 ₸."),
        said("Uchino полотенце банное 50х100 - 5 000 ₸."),
        said("Uchino полотенце банное 50х100 - 9 000 ₸. Какой цвет нужен?"),
      ],
    },
    steps: [
      {
        say: { text: "50х100" },
        expect: {
          says: ["9 000 ₸"],
          notSays: ["5 000", "менеджер"],
          sellerNotices: 0,
          paused: false,
        },
      },
    ],
  },
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
  {
    id: "pricelist-comment-rule-dm-not-manager-ig-ru",
    title:
      "первое сообщение правила Zernio на комментарий — не менеджер: на вопрос после него бот отвечает",
    origin:
      "скрин Якова, BOVI 16.10 10:31 (@futer_kostum.thebest): правило Zernio ответило на комментарий, «120/200 есть?) Здравствуйте» осталось без ответа, бот встал на паузу «менеджер отвечает»",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    echoes: true,
    tenantSettings: { zernio: { account_ids: ["acc-1"] } },
    automations: [
      {
        id: "bovi-rule",
        name: "BOVI",
        accountId: "acc-1",
        trigger: "comment",
        keywords: [],
        isActive: true,
        dmMessage:
          "Здравствуйте! С удовольствием поможем вам с подбором!\nУ нас в Bovi представлены разные коллекции и большой выбор постельного белья (размеры от 140х200 до 240х220 см). Цены начинаются от 70.000 тенге✨\n\nПодскажите, какой размер и цвет вам подобрать?",
      },
    ],
    arrange: (r) =>
      r.sellerTyped(
        1,
        "Здравствуйте! С удовольствием поможем вам с подбором!\nУ нас в Bovi представлены разные коллекции и большой выбор постельного белья (размеры от 140х200 до 240х220 см). Цены начинаются от 70.000 тенге✨\n\nПодскажите, какой размер и цвет вам подобрать?",
      ),
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [said("Здравствуйте. 120х200 нет, ближайший размер — 140х200.")],
    },
    steps: [
      {
        say: { text: "120/200 есть?)\nЗдравствуйте" },
        expect: { count: 1, says: ["140х200"], paused: false },
      },
    ],
  },
  {
    id: "pricelist-rubles-own-reply-not-manager-ig-ru",
    title:
      "свой ответ в рублях — не менеджер: на следующий вопрос бот отвечает, а не встаёт на паузу",
    origin:
      "скрин Якова, BOVI 15.10 02:38–02:40 (@cakelali555): цены в ₽, потом «200x220» и «В Россию отправляете СДЭКом?» без ответа",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    rubRate: 5,
    echoes: true,
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        said(
          "Цены привожу в тенге, вы увидите их в рублях: Uchino полотенце банное 50х100 - 9 000 ₸.",
        ),
        // Черновик выше — служебное («привожу в тенге»): сверка просит переписать.
        said("Uchino полотенце банное 50х100 - 9 000 ₸."),
        said("Uchino 50х100 в белом есть, 9 000 ₸ за штуку."),
      ],
    },
    steps: [
      {
        say: { text: "Можно в рублях" },
        expect: {
          count: 1,
          says: ["₽"],
          notSays: ["9 000 ₸", "в тенге", "увидите"],
          paused: false,
        },
      },
      {
        say: { text: "50х100" },
        expect: { count: 1, says: ["₽ за штуку"], paused: false },
      },
    ],
  },
  {
    id: "pricelist-rubles-no-tenge-talk-ig-ru",
    title:
      "«А в рублях?» — покупателю цена в ₽, без «цены называю в тенге, отобразятся в рублях автоматически»",
    origin:
      "BOVI 15.10 01:18, 02:38, 05:59: «Цены указываю в тенге, но у вас в чате суммы отобразятся в рублях», «Цены всё равно называю в тенге - для вас они отобразятся в рублях автоматически»",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    rubRate: 5,
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        said(
          "Цены всё равно называю в тенге - для вас они отобразятся в рублях автоматически. Uchino полотенце банное 50х100 - 9 000 ₸.",
        ),
        said("Uchino полотенце банное 50х100 - 9 000 ₸."),
      ],
    },
    steps: [
      {
        say: { text: "А в рублях?" },
        expect: {
          count: 1,
          says: ["₽"],
          notSays: ["в тенге", "отобразятся", "автоматически"],
          modelSees: ["служебное"],
          paused: false,
        },
      },
    ],
  },
  // ───── Задачи консультанта: передача менеджеру — строка у продавца (перенос v1 tasks.ts) ─────
  ...everyLocale(
    (l) => ({
      id: "pricelist-handoff-task",
      title:
        "передача менеджеру — задача в админке: причина, канал, суть, ответ покупателю прежний",
      origin:
        "BOVI 07.10: в v1 у продавца был список задач консультанта, в v2 передача жила только в Telegram",
      channel: "instagram",
      full: true,
      vertical: "consultant",
      modules: { shop: true },
      pricelist: {
        catalog: PL_CATALOG,
        rounds: [
          [
            {
              type: "tool_use",
              id: "h1",
              name: "handoff_to_manager",
              input: { reason: "purchase", summary: "Берёт Uchino 50х100, самовывоз" },
            },
          ],
        ],
      },
      steps: [
        {
          say: { text: "Беру полотенце Uchino, +77001112233, заберу сама" },
          expect: {
            says: [pricelistHandoffReply(l)],
            sellerNotices: 1,
            paused: true,
            tasks: [
              {
                reason: "purchase",
                done: false,
                text: expect.stringContaining("Берёт Uchino 50х100, самовывоз"),
              },
            ],
          },
        },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
  {
    id: "pricelist-handoff-task-tg-ru",
    title: "передача менеджеру из Telegram — задача с каналом telegram",
    origin: "BOVI 07.10: задачи консультанта из всех каналов, как в v1",
    channel: "telegram",
    locale: "ru",
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        [
          {
            type: "tool_use",
            id: "h1",
            name: "handoff_to_manager",
            input: { reason: "complaint", summary: "Пришло полотенце с затяжкой" },
          },
        ],
      ],
    },
    steps: [
      {
        say: { text: "Мне пришло полотенце с затяжкой, хочу вернуть" },
        expect: {
          says: [pricelistHandoffReply("ru")],
          tasks: [{ reason: "complaint", channel: "telegram", done: false }],
        },
      },
    ],
  },
  {
    id: "pricelist-human-call-task-ig-ru",
    title:
      "«позовите человека» у консультанта по прайсу — задача human, второй раз не задваивается",
    origin: "BOVI 07.10: «позвать продавца» (Б9) шло мимо списка задач",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: { catalog: PL_CATALOG, rounds: [] },
    steps: [
      {
        say: { text: "позовите менеджера" },
        expect: { sellerNotices: 1, tasks: [{ reason: "human_requested", channel: "instagram" }] },
      },
      {
        say: { text: "позовите менеджера" },
        expect: { sellerNotices: 0, tasks: [{ reason: "human_requested" }] },
      },
    ],
  },
  {
    id: "pricelist-purchase-no-phone-task-ig-ru",
    title:
      "«Да» на «Оформляем?» в Direct — задача менеджеру сразу, без телефона; телефон следом дописывается в задачу",
    origin:
      "BOVI 11.10, fokkiuo77 (Musi): бот попросил телефон, она замолчала — у Нурдина ни задачи, ни уведомления",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    username: "fokkiuo77",
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        [
          {
            type: "tool_use",
            id: "h1",
            name: "handoff_to_manager",
            input: {
              reason: "purchase",
              summary: "Москва, берёт Uchino 50х100, спрашивает оплату в рублях",
            },
          },
        ],
        said(
          "Способ оплаты пришлёт менеджер в этом чате. Напишите, пожалуйста, телефон и адрес доставки.",
        ),
      ],
    },
    steps: [
      {
        say: { text: "Да, как можно оплатить в рублях?" },
        expect: {
          says: ["Способ оплаты пришлёт менеджер в этом чате"],
          count: 1,
          sellerNotices: 1,
          paused: true,
          tasks: [
            {
              reason: "purchase",
              channel: "instagram",
              done: false,
              text: expect.stringContaining("оплату в рублях"),
            },
          ],
        },
      },
      {
        say: { text: "+7 916 123 45 67, Москва, ул. Тверская 1" },
        expect: {
          silent: true,
          tasks: [{ reason: "purchase", contact: expect.stringContaining("+7 916 123 45 67") }],
        },
      },
    ],
  },
  // ───── Задача закрывается сама, когда менеджер ответил (BOVI, партия 3.1) ─────
  ...(["instagram", "whatsapp"] as const).map((channel, i): Scenario => ({
    id: `pricelist-task-closes-on-app-reply-${channel === "instagram" ? "ig-ru" : "wa-kk"}`,
    title: "менеджер ответил прямо в приложении — задача консультанта закрыта, бот молчит",
    origin:
      "BOVI 08.10, разбор (партия 3.1): ответ из Instagram/WhatsApp ставил паузу, но задача оставалась открытой — список копился",
    channel,
    locale: i === 0 ? "ru" : "kk",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        [
          {
            type: "tool_use",
            id: "h1",
            name: "handoff_to_manager",
            input: { reason: "purchase", summary: "Берёт Uchino 50х100" },
          },
        ],
      ],
    },
    steps: [
      {
        say: { text: "Беру полотенце Uchino, +77001112233" },
        expect: { paused: true, tasks: [{ reason: "purchase", done: false }] },
      },
      {
        // Эхо собственного ответа бота — не ответ менеджера: задача открыта.
        say: { sellerWrites: pricelistHandoffReply(i === 0 ? "ru" : "kk") },
        expect: { silent: true, tasks: [{ done: false }] },
      },
      {
        say: { sellerWrites: "Здравствуйте! Оформлю заказ, пришлю реквизиты" },
        expect: { silent: true, tasks: [{ done: true, doneVia: channel }] },
      },
    ],
  })),
  ...(["instagram", "whatsapp"] as const).map((channel, i): Scenario => ({
    id: `pricelist-task-closes-on-poll-${channel === "instagram" ? "ig-ru" : "wa-uz"}`,
    title:
      "менеджер ответил в приложении, события Zernio нет и покупатель молчит — задачу закрывает опрос ящика",
    origin:
      "BOVI 08.10, сверка v3 после #579 (R5): подсказка обещала закрытие после ответа в Instagram, а оно ждало следующего сообщения покупателя",
    channel,
    locale: i === 0 ? "ru" : "uz",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        [
          {
            type: "tool_use",
            id: "h1",
            name: "handoff_to_manager",
            input: { reason: "purchase", summary: "Берёт Uchino 50х100" },
          },
        ],
      ],
    },
    steps: [
      {
        say: { text: "Беру полотенце Uchino, +77001112233" },
        expect: { paused: true, tasks: [{ reason: "purchase", done: false }] },
      },
      {
        // Эхо собственного ответа бота в ленте — не ответ менеджера.
        say: { appReply: pricelistHandoffReply(i === 0 ? "ru" : "uz") },
        expect: { silent: true, tasks: [{ done: false }] },
      },
      {
        say: { appReply: "Здравствуйте! Оформлю заказ, пришлю реквизиты" },
        expect: { silent: true, tasks: [{ done: true, doneVia: channel }] },
      },
    ],
  })),
  // ───── «💬 Связаться с менеджером» в Telegram без «Поддержки» — как передача (партия 3.3) ─────
  ...(
    [
      ["ru", "💬 Связаться с менеджером"],
      ["kk", "💬 Менеджермен байланысу"],
      ["uz", "💬 Menejer bilan bog‘lanish"],
    ] as const
  ).map(([l, button]): Scenario => ({
    id: `pricelist-contact-button-task-tg-${l}`,
    title:
      "кнопка «Связаться с менеджером» без модуля «Поддержка» — задача, пауза и карточка продавцу",
    origin:
      "BOVI 08.10, разбор (партия 3.3): кнопка отвечала ссылкой или «контакт не указан», задачи и уведомления не было, бот не замолкал",
    channel: "telegram",
    locale: l,
    vertical: "consultant",
    modules: { shop: true },
    state: { locale: l },
    pricelist: { catalog: PL_CATALOG, rounds: [] },
    steps: [
      {
        say: { text: button },
        expect: {
          says: [handoffReply(l)],
          paused: true,
          sellerNotices: 1,
          tasks: [{ reason: "human_requested", channel: "telegram", done: false }],
        },
      },
      {
        // Двойное нажатие — одна задача и одна карточка: менеджер уже позван.
        say: { text: button },
        expect: {
          says: [handoffReply(l)],
          sellerNotices: 0,
          tasks: [{ reason: "human_requested" }],
        },
      },
    ],
  })),
  // ───── Консультант BOVI: несколько сообщений подряд (08.10) ─────
  ...everyLocale(
    () => ({
      id: "pricelist-burst",
      title: "три сообщения подряд — не три ответа вперемешку: ход за ходом, история без потерь",
      origin:
        "BOVI 08.10, разбор: каждый вебхук запускал консультанта параллельно — два-три ответа, история одного хода затиралась",
      channel: "instagram",
      full: true,
      vertical: "consultant",
      modules: { shop: true },
      pricelist: {
        catalog: PL_CATALOG,
        rounds: [
          said("Здравствуйте! Подскажу по прайсу."),
          said("Да, полотенце Uchino есть, белое."),
        ],
      },
      steps: [
        {
          // Первое сообщение берёт ход; второе и третье, пришедшие, пока модель
          // думала, получают один общий ответ следующим ходом.
          say: { burst: ["Здравствуйте", "Есть полотенца?", "А белые?"] },
          expect: { count: 2, history: ["Здравствуйте", "Есть полотенца?", "А белые?"] },
        },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
  {
    id: "pricelist-burst-tg-ru",
    title: "два сообщения подряд в Telegram — ответы по очереди, оба вопроса в истории",
    origin:
      "BOVI 08.10, разбор: параллельные ходы консультанта, тот же путь runConsultant в Telegram",
    channel: "telegram",
    locale: "ru",
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [said("Здравствуйте! Подскажу по прайсу."), said("Да, полотенце Uchino есть.")],
    },
    steps: [
      {
        say: { burst: ["Здравствуйте", "Есть полотенца?"] },
        expect: { count: 2, history: ["Здравствуйте", "Есть полотенца?"] },
      },
    ],
  },
  {
    id: "pricelist-burst-handoff-ig-ru",
    title: "первый ход передал диалог менеджеру — второе сообщение подряд бот не отвечает",
    origin:
      "BOVI 08.10, разбор: параллельный ход отвечал покупателю поверх только что позванного менеджера",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        [
          {
            type: "tool_use",
            id: "h1",
            name: "handoff_to_manager",
            input: { reason: "complaint", summary: "Полотенце с затяжкой" },
          },
        ],
      ],
    },
    steps: [
      {
        say: { burst: ["Хочу вернуть полотенце", "Оно с затяжкой"] },
        expect: {
          // Один ответ — передача; второе сообщение ждёт и видит паузу.
          count: 1,
          says: [pricelistHandoffReply("ru")],
          paused: true,
          sellerNotices: 1,
          history: ["Хочу вернуть полотенце", "Оно с затяжкой"],
        },
      },
    ],
  },
  ...everyLocale(
    () => ({
      id: "pricelist-late-delivery",
      title: "сообщение, доставленное через два часа, — без ответа, но в истории",
      origin:
        "BOVI 08.10, разбор: Zernio повторяет недоставленный вебхук часами, бот отвечал на старое как на новое",
      channel: "instagram",
      full: true,
      vertical: "consultant",
      modules: { shop: true },
      pricelist: { catalog: PL_CATALOG, rounds: [said("Да, полотенце Uchino есть.")] },
      steps: [
        {
          say: { late: "Есть полотенца?", minutes: 120 },
          expect: { silent: true, sellerNotices: 0, history: ["Есть полотенца?"] },
        },
        {
          say: { text: "А белые есть?" },
          expect: { count: 1, history: ["Есть полотенца?", "А белые есть?"] },
        },
      ],
    }),
    ["instagram", "whatsapp"],
  ),
  // ───── Консультант BOVI: срез 10.10 (lenakzm, tolkin8) ─────
  {
    id: "pricelist-partial-words-ig-ru",
    title:
      "«полотенце чалма для волос»: слова «чалма» в прайсе нет — поиск отдаёт полотенце для волос, а не «нет»",
    origin:
      "BOVI 09.10 22:28, lenakzm: поиск требовал все слова, модель сказала «нет», хотя Uchino для волос за 25 000 ₸ был в прайсе",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: [...PL_CATALOG, PL_HAIR_TOWEL],
      rounds: [
        [
          {
            type: "tool_use",
            id: "s1",
            name: "search_products",
            input: { query: "полотенце чалма для волос" },
          },
        ],
        said("Есть Uchino полотенце для волос 38х80, серое — 25 000 ₸."),
      ],
    },
    steps: [
      {
        say: { text: "Есть полотенце для головы, которое влагу впитывает?" },
        expect: {
          count: 1,
          says: ["25 000"],
          notSays: [pricelistHandoffReply("ru")],
          sellerNotices: 0,
          // Выдача поиска, которую видела модель: позиция и какие слова не совпали.
          modelSees: ["Beauty Hair Strech Towel", "partial_match", "чалма"],
        },
      },
    ],
  },
  {
    id: "pricelist-photo-burst-ig-ru",
    title: "три фото одним касанием и подпись — один ответ, модель видит все три фото",
    origin:
      "BOVI 10.10 07:35, tolkin8: на три вложения ушло три ответа, каждый с «Здравствуйте»; lenakzm 09.10 22:34 — «Таких нет?» и два фото",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [said("Похоже на Uchino банное 50x100 — 9 000 ₸.")],
    },
    steps: [
      {
        say: { photos: 3, caption: "Таких нет?" },
        expect: {
          count: 1,
          modelImages: [3],
          modelSees: ["Таких нет?"],
          history: ["Таких нет?"],
        },
      },
    ],
  },
  {
    id: "pricelist-photo-burst-gaps-ig-ru",
    title:
      "фото пачки приходят с разрывом в секунды — ход ждёт тишины и отвечает на все фото и подпись одним ответом",
    origin:
      "BOVI 11.10, ночной срез: фото tolkin8 приходили с разрывом 4–12 с, а ход ждал только 2,5 с от первого — остальные получали отдельные ответы",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [said("Похоже на Uchino банное 50x100 — 9 000 ₸.")],
    },
    steps: [
      {
        // Тишина в тестах — 100 мс, разрыв — 60 мс: прежнее ожидание (100 мс от
        // взятия хода) теряло третье фото и подпись.
        say: { photos: 3, caption: "Таких нет?", gapMs: 60 },
        expect: {
          count: 1,
          modelImages: [3],
          modelSees: ["Таких нет?"],
          history: ["Таких нет?"],
        },
      },
    ],
  },
  {
    id: "pricelist-color-with-price-ig-ru",
    title: "«Дозатор есть в каком цвете?» — цвета вместе с ценой из поиска, без передачи менеджеру",
    origin:
      "BOVI 10.10 23:49, indirenokars: бот перечислил цвета дозатора Blomus SONO, но не назвал цену 33 000 ₸",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: [...PL_CATALOG, PL_DISPENSER],
      rounds: [
        [
          {
            type: "tool_use",
            id: "s1",
            name: "search_products",
            input: { query: "дозатор" },
          },
        ],
        said("Медный, чёрный и розовый — 33 000 ₸."),
      ],
    },
    steps: [
      {
        say: { text: "Дозатор есть в каком цвете?" },
        expect: {
          count: 1,
          says: ["33 000"],
          notSays: [pricelistHandoffReply("ru")],
          // Цена была в выдаче поиска; правило «цвет — вместе с ценой» — в
          // подсказке v2.22 (pricelist/persona.test.ts).
          modelSees: ["Blomus SONO", "33"],
        },
      },
    ],
  },
  {
    id: "pricelist-greet-once-ig-ru",
    title: "«Здравствуйте» — только в первом ответе разговора, дальше сразу к делу",
    origin: "BOVI 10.10, tolkin8 и lenakzm: по четыре «Здравствуйте» за пару минут",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [
        said("Здравствуйте. Что подсказать?"),
        said("Здравствуйте. Есть Uchino, для чего нужно полотенце?"),
      ],
    },
    steps: [
      { say: { text: "Здравствуйте" }, expect: { says: ["Здравствуйте"] } },
      {
        say: { text: "Есть полотенца?" },
        expect: {
          says: ["Есть Uchino"],
          notSays: ["Здравствуйте"],
          modelSees: ["не здоровайтесь снова"],
        },
      },
    ],
  },
  {
    id: "pricelist-invisible-attachment-ig-ru",
    title: "вложение без ссылки — модель знает, что его не видно, и не выдаёт догадку за факт",
    origin:
      "BOVI 10.10 07:35, tolkin8: на «[вложение без ссылки]» бот назвал одеяла Traumina из хитов как факт",
    channel: "instagram",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { shop: true },
    pricelist: {
      catalog: PL_CATALOG,
      rounds: [said("Не вижу вложение. Пришлите, пожалуйста, скрин или название товара.")],
    },
    steps: [
      {
        say: { attachmentNoUrl: true },
        expect: {
          count: 1,
          says: ["скрин"],
          modelSees: ["его не видно", "Не угадывайте товар"],
        },
      },
    ],
  },
  // ───── «Карта РФ / СБП» в Instagram: бот молчал (заказ #15 Копилки Русоведа, 09.10) ─────
  {
    id: "prodamus-link-rub-ig-ru",
    title: "ссылка на Продамус без рублёвой цены — только тенге, курс продавца не подставляется",
    origin: "заказ #85 Копилки Русоведа, Яков 10.10 09:45: «цена всё равно только в тенге»",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "choose_pay", pending_order_id: 15, pending_display_no: 15 },
    arrange: (r) => {
      prodamusOrder(r);
      r.db.tables.app_settings!.push({ key: "prodamus_rate", value: "3,573" });
    },
    steps: [
      {
        say: { button: "PAY:pdm" },
        expect: {
          count: 1,
          says: ["К оплате: 150 ₸\n"],
          notSays: ["₽"],
          state: { mode: "awaiting_payment" },
        },
      },
    ],
  },
  {
    id: "prodamus-paid-word-before-webhook-ig-ru",
    title:
      "«Оплатила» сразу после оплаты картой, уведомление Продамуса ещё не пришло: бот говорит, что заказ подтвердится сам и материалы придут сюда, а не только «оплата по кнопке выше»",
    origin:
      "заказ #102 Копилки 10.10 12:34: «Оплатила» за 11 с до уведомления Продамуса, бот ответил «Оплата — по кнопке выше», наблюдатель решил, что оплата зависла",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "choose_pay", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      { say: { button: "PAY:pdm" }, expect: { state: { mode: "awaiting_payment" } } },
      {
        say: { text: "Оплатила" },
        expect: {
          count: 1,
          says: ["Если уже оплатили", "материалы придут сюда"],
          notSays: ["Пришлите"],
        },
      },
    ],
  },
  {
    id: "prodamus-link-question-ig-ru",
    title:
      "после «Картой РФ» кнопка ссылки называется иначе, чем способ оплаты; «А ссылка где?» — ссылка текстом, не «пришлите чек»",
    origin:
      "заказ #98 Копилки Русоведа 10.10 11:35: после «💳 Картой РФ» пришла кнопка с тем же названием, покупательница спросила «А ссылка где?», бот попросил чек",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "choose_pay", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      {
        say: { button: "PAY:pdm" },
        expect: {
          count: 1,
          buttons: [COPY.ru.payLinkBtn(false)],
          state: { mode: "awaiting_payment" },
        },
      },
      {
        say: { text: "А ссылка где?" },
        expect: {
          count: 1,
          says: ["https://kopilka.proeducation.kz/?do=pay"],
          notSays: ["чек"],
          state: { mode: "awaiting_payment" },
        },
      },
      {
        // Решение Якова 11.10: непонятное на шаге оплаты — продавцу, бот молчит.
        say: { text: "." },
        expect: { silent: true, state: { mode: "awaiting_payment" } },
      },
      {
        say: { text: "Оплатила" },
        expect: { count: 1, says: [(c) => c.payLinkAboveHint], notSays: ["Пришлите"] },
      },
    ],
  },
  {
    id: "prodamus-link-ig-ru",
    title:
      "касса в тенге — «💳 Картой РФ» (форма *.kz берёт только карты РФ); ссылка кнопкой, текст не длиннее предела Meta",
    origin: "заказ #15 Копилки Русоведа, скрин Кристины 09.10: после кнопки бот ничего не прислал",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "choose_pay", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      {
        say: { button: "PAY:pdm" },
        expect: {
          count: 1,
          // Форма *.kz принимает только карты РФ (скрин формы Копилки, 10.10).
          says: [(c) => c.prodamusCardHint, "150 ₸", "российского банка"],
          buttons: [COPY.ru.payLinkBtn(false)],
          state: { mode: "awaiting_payment", pending_order_id: 15 },
        },
      },
    ],
  },
  {
    id: "rf-card-failed-reoffers-choice-ig-ru",
    title:
      "«Картой РФ» снова и «Не получается оплатить» — не жалоба «оплатила и не получила»: ответ «передал продавцу» и ещё раз выбор оплаты с Kaspi",
    origin:
      "Копилка 12.10 16:59, sofronovaaaaaa #131: второй раз «💳 Картой РФ» и «Здравствуйте Не получается оплатить» — бот повторил ссылку Продамуса, на текст промолчал, обращение #138",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    triage: [{ kind: "payment_failed" }],
    state: {
      mode: "awaiting_payment",
      pending_order_id: 15,
      pending_display_no: 15,
      pay_link: "pdm",
    },
    arrange: (r) => {
      prodamusOrder(r);
      r.db.tables.orders!.find((o) => o.id === 15)!.country_code = "KZ";
      r.db.tables.payment_methods![0]!.instructions = "Kaspi Gold 4400 4302 1234 5678, Кристина У.";
    },
    steps: [
      {
        say: { text: "Здравствуйте \nНе получается оплатить" },
        expect: {
          count: 2,
          says: [(c) => c.payTroubleHandoff, "только карты российских банков"],
          buttons: [COPY.ru.payKaspiBtn, "💳 Картой РФ"],
          state: { mode: "choose_pay", pending_order_id: 15 },
        },
      },
    ],
  },
  {
    id: "checkout-again-shows-pending-order-ig-ru",
    title:
      "заказ ждёт выбора оплаты, снова «Оформить заказ» — тот же заказ с кнопками оплаты, а не «Корзина пуста»",
    origin:
      "заказ #19 Копилки русоведа 09.10 16:5x: кнопки оплаты не заметила, дважды «Оформить заказ» → «Корзина пуста» → каталог",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "choose_pay", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      {
        say: { button: "CHECKOUT", title: "✅ Оформить заказ" },
        expect: {
          count: 1,
          says: ["150 ₸", `«${COPY.ru.payByCardBtn}»`],
          notSays: [(c) => c.cartEmpty],
          buttons: [COPY.ru.payByCardBtn],
          state: { mode: "choose_pay", pending_order_id: 15 },
        },
      },
    ],
  },
  {
    id: "pay-trouble-from-russia-ig-ru",
    title:
      "«не смогла оплатить», «я из России, можно по номеру» — не «пришлите чек», а вопрос продавцу",
    origin:
      "заказ #46 Копилки русоведа 09.10: «У меня спрашивают номер телефона», «Я не смогла оплатить» — бот ответил «Пришлите чек»",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "awaiting_payment", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      {
        say: { text: "Я не смогла оплатить" },
        expect: {
          count: 1,
          says: [(c) => c.payTroubleHandoff],
          notSays: [(c) => c.dmReceiptPrompt],
        },
      },
      {
        say: { text: "Я из России, у меня карта не проходит" },
        expect: { says: [(c) => c.payTroubleHandoff], notSays: [(c) => c.dmReceiptPrompt] },
      },
    ],
  },
  {
    id: "rubles-get-card-link-ig-ru",
    title:
      "«Российскими рублями» при Продамусе без реквизитов РФ — сразу ссылка картой, не продавцу",
    origin:
      "заказ #73 Копилки русоведа 10.10 (rayana.775): «Российскими рублями» → «Передал продавцу»; Яков: реквизитов РФ нет, форма Продамуса принимает карты РФ",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "choose_pay", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      {
        say: { text: "Российскими рублями" },
        expect: {
          count: 1,
          says: [(c) => c.prodamusRubViaKztHint],
          buttons: [COPY.ru.payLinkBtn(false)],
          notSays: [(c) => c.payTroubleHandoff, (c) => c.dmReceiptPrompt],
          state: { mode: "awaiting_payment" },
        },
      },
      {
        say: { text: "Я из России, можно оплатить?" },
        expect: {
          count: 1,
          says: [(c) => c.prodamusRubViaKztHint],
          notSays: [(c) => c.payTroubleHandoff],
        },
      },
    ],
  },
  {
    id: "pay-trouble-from-belarus-ig-ru",
    title: "«Я из Беларуси» на шаге оплаты — вопрос продавцу, а не «пришлите чек»",
    origin:
      "заказ #62 Копилки русоведа 09.10 (nadegdastachovez): «Я из Беларуси» — бот ответил «Пришлите чек»",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "awaiting_payment", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      {
        say: { text: "Я из Беларуси" },
        expect: {
          count: 1,
          says: [(c) => c.payTroubleHandoff],
          notSays: [(c) => c.dmReceiptPrompt],
        },
      },
      {
        say: { text: "А из Узбекистана можно оплатить? Каспи у меня нет" },
        expect: { says: [(c) => c.payTroubleHandoff], notSays: [(c) => c.dmReceiptPrompt] },
      },
    ],
  },
  // ───── Ожидание оплаты: вопрос — продавцу, а не «Пришлите чек» (решение Якова 11.10, п.1) ─────
  {
    id: "awaiting-proof-question-silent-ig-ru",
    title:
      "ждём чек, покупатель спрашивает — бот молчит (вопрос продавцу), заказ ждёт оплаты, фото чека после этого принимается",
    origin:
      "AATeach 11.10 09:27 (saraabdinasirova, #1384): «А этот материал точно придёт? Боюсь мошенников», «Почему сейчас надо платить, а не при получении?» → «Пришлите чек»",
    channel: "instagram",
    locale: "ru",
    full: true,
    products: PRODUCTS,
    receipts: true,
    state: {
      mode: "awaiting_proof",
      pending_order_id: 82,
      direct: { last_reply: "К оплате", last_reply_at: new Date().toISOString() },
    },
    arrange: (r) => {
      paidOrder({ status: "awaiting_payment" })(r);
      r.db.tables.app_settings!.push({ key: "chat_email_ask", value: "false" });
    },
    steps: [
      {
        say: { text: "А этот материал точно придёт? Боюсь мошенников" },
        expect: { silent: true, state: { mode: "awaiting_proof", pending_order_id: 82 } },
      },
      {
        say: { text: "Почему сейчас надо платить, а не при получении?" },
        expect: { silent: true, state: { mode: "awaiting_proof" } },
      },
      { say: { photo: true }, expect: { says: [(c) => c.proofReceived(82)] } },
    ],
  },
  {
    id: "awaiting-proof-question-to-seller-tg-ru",
    title:
      "Telegram: ждём чек, покупатель спрашивает — вопрос уходит продавцу, а не «пришлите чек»; «оплатила» — просьба о чеке",
    origin:
      "AATeach 11.10 (D3: «Куда вышлет материалы?» → «Пришлите фото чека»); решение Якова 11.10, п.1",
    channel: "telegram",
    locale: "ru",
    products: PRODUCTS,
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { text: "Куда вышлет материалы?" },
        expect: {
          notSays: [(c) => c.sendReceiptPrompt],
          sellerNotices: 1,
          state: { mode: "awaiting_proof", pending_order_id: 82 },
        },
      },
      {
        say: { text: "Оплатила" },
        expect: { says: [(c) => c.sendReceiptPrompt], sellerNotices: 0 },
      },
    ],
  },
  {
    id: "awaiting-proof-other-product-question-silent-ig-ru",
    title: "ждём чек, «вместе сколько будет?» про другой материал — бот молчит, не просит чек",
    origin:
      "AATeach 11.10 07:23 (attokurovasaida): «Карточки поощрений тоже. Вместе сколько будет» → «Пришлите чек»; 07:27 «Я ещё не отправила деньги»",
    channel: "instagram",
    locale: "ru",
    full: true,
    products: PRODUCTS,
    state: {
      mode: "awaiting_proof",
      pending_order_id: 82,
      direct: { last_reply: "К оплате", last_reply_at: new Date().toISOString() },
    },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { text: "Карточки поощрений тоже. Вместе сколько будет" },
        expect: { silent: true, state: { mode: "awaiting_proof" } },
      },
      {
        say: { text: "Я ещё не отправила деньги. Хочу приобрести и другие материалы" },
        expect: { silent: true, notSays: [(c) => c.dmReceiptPrompt] },
      },
      {
        say: { text: "Оплатила" },
        expect: { count: 1, says: [(c) => c.dmReceiptPrompt], state: { mode: "awaiting_proof" } },
      },
    ],
  },
  {
    id: "awaiting-proof-paid-report-asks-receipt-ig-ru",
    title: "ждём чек, «оплатила» — бот просит чек: это не вопрос, а сообщение об оплате",
    origin: "ожидание к awaiting-proof-question-silent-ig-ru; заказ #93 Копилки 10.10",
    channel: "instagram",
    locale: "ru",
    full: true,
    products: PRODUCTS,
    state: {
      mode: "awaiting_proof",
      pending_order_id: 82,
      direct: { last_reply: "К оплате", last_reply_at: new Date().toISOString() },
    },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { text: "Перевела 1400 на каспи" },
        expect: { count: 1, says: [(c) => c.dmReceiptPrompt], state: { mode: "awaiting_proof" } },
      },
    ],
  },
  {
    id: "order-email-not-email-releases-ig-ru",
    title:
      "после «на какую почту?» покупатель пишет не почту — бот отпускает шаг и разбирает сообщение как обычно, без «не похоже на почту»",
    origin:
      "AATeach 11.10 (galinaganchikina, #1380): «А на ватсап мой можно?», «Члены предложения, как купить», «212», «350» → трижды «Это не похоже на адрес почты»",
    channel: "instagram",
    locale: "ru",
    full: true,
    products: PRODUCTS,
    state: {
      mode: "awaiting_order_email",
      pending_order_id: 82,
      direct: { last_reply: "На какую почту?", last_reply_at: new Date().toISOString() },
    },
    arrange: paidOrder(),
    steps: [
      {
        say: { text: "А на ватсап мой можно?" },
        expect: { notSays: [(c) => c.emailHint], state: { mode: "idle" } },
      },
      { say: { text: "212" }, expect: { notSays: [(c) => c.emailHint] } },
    ],
  },
  {
    id: "order-email-typo-asks-again-ig-ru",
    title:
      "после «на какую почту?» адрес с опечаткой (есть «@») — бот просит ещё раз, шаг остаётся",
    origin: "ожидание к order-email-not-email-releases-ig-ru",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: {
      mode: "awaiting_order_email",
      pending_order_id: 82,
      direct: { last_reply: "На какую почту?", last_reply_at: new Date().toISOString() },
    },
    arrange: paidOrder(),
    steps: [
      {
        say: { text: "anna@mailru" },
        expect: { says: [(c) => c.emailHint], state: { mode: "awaiting_order_email" } },
      },
    ],
  },
  {
    id: "pay-trouble-then-thanks-no-receipt-prompt-ig-ru",
    title: "после «передал продавцу» на «Спасибо» бот молчит, а не просит чек",
    origin:
      "заказ #65 Копилки русоведа 10.10 (sultanahmedovatamila798): «Рублями сколько стоит? Я с Дагестана» → «Передал продавцу», на «Спасибо ❤️» — «Пришлите чек»",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "choose_pay", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      {
        say: { text: "Не могу оплатить российской картой" },
        expect: {
          count: 1,
          says: [(c) => c.payTroubleHandoff],
          notSays: [(c) => c.dmReceiptPrompt],
        },
      },
      { say: { text: "Спасибо ❤️" }, expect: { silent: true } },
      { say: { text: "Хорошо, жду" }, expect: { silent: true } },
    ],
  },
  {
    id: "paid-kaspi-no-menu-buttons-ig-ru",
    title:
      "«Оплатила на каспи» — просьба прислать чек без «нажмите кнопку ниже»: кнопок под ней нет",
    origin:
      "заказ #93 Копилки Русоведа 10.10 (Ахтамберова, «Перевод Kaspi»): «Оплатила на каспи 1700» → «…нажмите любую кнопку ниже», а кнопок в Instagram нет",
    channel: "instagram",
    locale: "ru",
    full: true,
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    state: {},
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { says: ["К оплате"], state: { mode: "awaiting_proof" } },
      },
      {
        say: { text: "Оплатила на каспи 1700" },
        expect: {
          count: 1,
          says: [(c) => c.dmReceiptPrompt],
          notSays: ["кнопку ниже"],
          state: { mode: "awaiting_proof" },
        },
      },
    ],
  },
  {
    id: "receipt-how-to-after-paid-ig-ru",
    title: "«Не знаю как» после «пришлите чек» — бот объясняет, как приложить скриншот",
    origin:
      "заказ #72 Копилки русоведа 10.10 (_tatyana_tarasenko1820): «Я оплатила» → «Пришлите чек», «Не знаю как» → бот молчит",
    channel: "instagram",
    locale: "ru",
    full: true,
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    state: {},
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { says: ["К оплате"], state: { mode: "awaiting_proof" } },
      },
      {
        say: { text: "Я оплатила" },
        expect: { count: 1, says: [(c) => c.dmReceiptPrompt] },
      },
      {
        say: { text: "Не знаю как" },
        expect: {
          count: 1,
          says: [(c) => c.receiptHowTo],
          notSays: [(c) => c.dmReceiptPrompt],
          state: { mode: "awaiting_proof" },
        },
      },
      {
        say: { text: "А куда скинуть чек?" },
        expect: { count: 1, says: [(c) => c.receiptHowTo] },
      },
    ],
  },
  {
    id: "choose-pay-no-receipt-prompt-ig-ru",
    title: "способ оплаты не выбран — бот не просит чек; «Я из Нукуса» — продавцу",
    origin:
      "заказ #76 Копилки русоведа 10.10: «Я из Нукуса» до выбора способа оплаты — бот ответил «Пришлите чек»",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "choose_pay", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      {
        say: { text: "Я из Нукуса" },
        expect: {
          count: 1,
          says: [(c) => c.payTroubleHandoff],
          notSays: [(c) => c.dmReceiptPrompt],
        },
      },
    ],
  },
  {
    id: "choose-pay-unclear-text-hint-ig-ru",
    title:
      "вопрос до выбора способа оплаты — бот молчит (продавцу); «оплатила» — «выберите способ», не «пришлите чек»",
    origin:
      "заказ #76 Копилки русоведа 10.10; решение Якова 11.10 (вопрос в ожидании оплаты — продавцу)",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { prodamus: true },
    products: [{ id: P1, name: "Палитра средств выразительности" }],
    arrange: (r) => {
      r.db.tables.app_settings!.push(
        { key: "prodamus_enabled", value: "true" },
        { key: "prodamus_form_url", value: "https://kopilka.proeducation.kz" },
        { key: "prodamus_secret_key", value: "k".repeat(64) },
        { key: "prodamus_currency", value: "KZT" },
      );
    },
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { state: { mode: "choose_pay" } },
      },
      {
        say: { text: "А это подойдёт учителю начальных классов?" },
        expect: { silent: true, state: { mode: "choose_pay" } },
      },
      {
        say: { text: "Я оплатила" },
        expect: {
          count: 1,
          says: [(c) => c.choosePayHint],
          notSays: [(c) => c.dmReceiptPrompt],
        },
      },
    ],
  },
  {
    id: "russian-region-gets-card-link-ig-ru",
    title: "«Я с Дагестана» — регион России: ссылка картой, а не продавцу",
    origin: "заказ #65 Копилки русоведа 10.10 (sultanahmedovatamila798): «Я с Дагестана»",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    state: { mode: "choose_pay", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      {
        say: { text: "Я с Дагестана" },
        expect: {
          count: 1,
          says: [(c) => c.prodamusRubViaKztHint],
          notSays: [(c) => c.payTroubleHandoff, (c) => c.dmReceiptPrompt],
        },
      },
    ],
  },
  {
    id: "prodamus-link-no-buttons-ig-ru",
    title: "кнопки канал не принял — ссылка на оплату приходит текстом",
    origin: "заказ #15 Копилки Русоведа, 09.10",
    channel: "instagram",
    locale: "ru",
    modules: { prodamus: true },
    rejectButtons: true,
    state: { mode: "choose_pay", pending_order_id: 15, pending_display_no: 15 },
    arrange: prodamusOrder,
    steps: [
      {
        say: { button: "PAY:pdm" },
        expect: {
          count: 1,
          says: [(c) => c.prodamusCardHint, "https://kopilka.proeducation.kz/?do=pay"],
          state: { mode: "awaiting_payment" },
        },
      },
    ],
  },
  // ───── Одна страна оплаты: не спрашивать (тестер из России, Копилка Русоведа, 09.10) ─────
  {
    id: "sole-country-tg-ru",
    title: "страна оплаты одна — бот не спрашивает её, каталог открывается сразу",
    origin:
      "скрин Якова 09.10: покупателю из России бот показал «Выберите страну оплаты» с одной кнопкой «Казахстан»",
    channel: "telegram",
    locale: "ru",
    products: PRODUCTS,
    state: { country_code: undefined },
    steps: [
      {
        say: { button: "cat:root" },
        expect: {
          notSays: [(c) => c.chooseCountry],
          state: { country_code: "KZ", country_name: "Казахстан" },
        },
      },
    ],
  },
  {
    id: "two-countries-tg-ru",
    title: "стран оплаты две — бот спрашивает, какая",
    origin: "ожидание к sole-country-tg-ru",
    channel: "telegram",
    locale: "ru",
    products: PRODUCTS,
    state: { country_code: undefined },
    arrange: (r) => {
      r.db.tables.payment_methods!.push({
        id: "pm2",
        bot_id: r.db.tables.payment_methods![0]!.bot_id,
        is_active: true,
        sort_order: 2,
        country_code: "UZ",
        country_name: "Узбекистан",
        currency: "UZS",
      });
    },
    steps: [{ say: { button: "cat:root" }, expect: { says: [(c) => c.chooseCountry] } }],
  },
  // ───── Страна словами (AATeach, ночь 11.10) ─────
  {
    id: "country-words-at-step-ig-ru",
    title:
      "на вопрос о стране ответ словами «Я из России» — страна Россия, список второй раз не приходит",
    origin:
      "AATeach 11.10 00:09 rizamagomedova1: «Я из России» → список снова → «1» → Казахстан и цена в тенге",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: { country_code: null, country_name: null },
    arrange: twoCountries,
    countryAi: [{ country: "RU", answer_only: true }],
    steps: [
      {
        say: { text: "каталог" },
        expect: { says: [(c) => c.chooseCountry], state: { mode: "awaiting_country" } },
      },
      {
        say: { text: "Я из России" },
        expect: {
          says: ["Россия", "018. Прописи"],
          notSays: [(c) => c.chooseCountry],
          state: { country_code: "RU", mode: "idle" },
        },
      },
    ],
  },
  {
    id: "country-words-no-ai-ig-ru",
    title: "модели нет — «Здравствуйте, из России» всё равно Россия (запасной разбор)",
    origin: "AATeach 11.10 valya.falling: «Здравствуйте, из России» → список → «2»",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: { country_code: null, country_name: null },
    arrange: twoCountries,
    steps: [
      { say: { text: "каталог" }, expect: { says: [(c) => c.chooseCountry] } },
      {
        say: { text: "Здравствуйте, из России" },
        expect: { notSays: [(c) => c.chooseCountry], state: { country_code: "RU" } },
      },
    ],
  },
  {
    id: "country-reply-no-button-ig-ru",
    title:
      "ответ страной на первое сообщение правила без кнопки — бот страну запомнил молча, сообщение осталось продавцу",
    origin:
      "AATeach 11.10 07:47: sidorova2765 «РФ» под «ПАДЕЖИ» (первое сообщение само спрашивает страну) → «Записал страну… Продавец ответит» — «бот опять реагирует на страны»",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { manager_chat: true },
    products: PRODUCTS,
    state: { country_code: null, country_name: null },
    arrange: twoCountries,
    countryAi: [
      { country: "RU", answer_only: true },
      { country: "RU", answer_only: true },
    ],
    steps: [
      {
        say: { text: "Россия" },
        expect: { silent: true, state: { country_code: "RU" } },
      },
      { say: { text: "РФ" }, expect: { silent: true, state: { country_code: "RU" } } },
    ],
  },
  {
    id: "country-reply-race-ig-ru",
    title: "два «Россия» одновременно (двойная отправка) — ответ про страну один",
    origin: "гонка к country-reply-buy-button-ig-ru (CLAUDE.md: «один раз» — условная запись)",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { manager_chat: true },
    products: PRODUCTS,
    state: { country_code: null, country_name: null },
    arrange: twoCountriesBuySent,
    countryAi: [
      { country: "RU", answer_only: true },
      { country: "RU", answer_only: true },
    ],
    steps: [
      {
        say: { burst: ["Россия", "Россия!"] },
        expect: { count: 1, says: ["Записал страну"], state: { country_code: "RU" } },
      },
    ],
  },
  {
    id: "country-reply-buy-button-ig-kk",
    title: "то же по-казахски под «Купить»: «Ресей» — ел жазылды, жауап бір рет",
    origin: "AATeach ночь 11.10, ожидание к country-reply-buy-button-ig-ru",
    channel: "instagram",
    locale: "kk",
    full: true,
    modules: { manager_chat: true },
    products: PRODUCTS,
    state: { country_code: null, country_name: null },
    arrange: twoCountriesBuySent,
    countryAi: [{ country: "RU", answer_only: true }],
    steps: [
      {
        say: { text: "Ресей" },
        expect: { count: 1, says: ["Елді жазып алдым"], state: { country_code: "RU" } },
      },
    ],
  },
  {
    id: "country-reply-buy-button-ig-ru",
    title:
      "страна после кнопки «Купить» правила — «нажмите «Купить» выше»; по нажатию страну не спрашивают второй раз",
    origin:
      "AATeach 11.10: vikabagutskaya «Беларусь» → список стран → «4»; «Купить» спрашивал страну заново",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: { country_code: null, country_name: null },
    arrange: twoCountriesBuySent,
    countryAi: [{ country: "RU", answer_only: true }],
    steps: [
      {
        say: { text: "Я из России" },
        expect: {
          count: 1,
          says: ["Записал страну: 🇷🇺 Россия", "Нажмите «Купить» в сообщении выше"],
          state: { country_code: "RU" },
        },
      },
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { notSays: [(c) => c.chooseCountry], state: { country_code: "RU" } },
      },
    ],
  },
  {
    id: "country-with-question-stays-seller-ig-ru",
    title: "«Я из России, как оплатить?» — страну запомнили, но отвечать за продавца бот не стал",
    origin: "ожидание к country-reply-no-button-ig-ru",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    state: { country_code: null, country_name: null },
    arrange: twoCountries,
    countryAi: [{ country: "RU", answer_only: false }],
    steps: [
      {
        say: { text: "Я из России, как оплатить?" },
        expect: { notSays: ["Записал страну"], state: { country_code: "RU" } },
      },
    ],
  },
  {
    id: "dm-section-name-not-rule-keyword-ig-ru",
    title:
      "название раздела в ответ на каталог открывает раздел, а не «Купить» правила без кодовых слов",
    origin:
      "заказ #127 Копилки русоведа 11.10 (musaevazabida2022): «Оформление и праздники» после списка разделов → кнопка «Купить» Палитры",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "musaevazabida2022",
    tenantSettings: { zernio: { profile_id: "prof-1", account_ids: ["acc-1"] } },
    products: [
      { id: P1, name: "Палитра средств выразительности", price: 1700 },
      { id: P2, name: "Небосвод писателей", price: 150 },
    ],
    // Правило рилса «Палитра» без кодовых слов (отвечает на любой комментарий);
    // в его сообщениях есть «оформление» и «праздники».
    automations: [
      {
        id: "pal",
        name: "Палитра",
        accountId: "acc-1",
        trigger: "comment",
        keywords: [],
        isActive: true,
        postTitle: 'Пишите в комментариях слово "Палитра" и я вышлю подробную информацию.',
        dmMessage: "Таблички к оформлению кабинета и к праздникам",
        buttons: [{ type: "postback", title: "Купить", payload: `PROD:${P1}` }],
      },
    ],
    arrange: (r) => {
      r.db.tables.categories = [
        {
          id: "c1",
          bot_id: r.db.tables.payment_methods![0]!.bot_id,
          name: "Палитры",
          parent_id: null,
          is_visible: true,
          sort_order: 1,
        },
        {
          id: "c2",
          bot_id: r.db.tables.payment_methods![0]!.bot_id,
          name: "Оформление и праздники",
          parent_id: null,
          is_visible: true,
          sort_order: 2,
        },
      ];
      r.db.tables.products![0]!.category_ids = ["c1"];
      r.db.tables.products![1]!.category_ids = ["c2"];
    },
    steps: [
      {
        say: { button: "CATALOG", title: "📚 Каталог" },
        expect: { says: ["Оформление и праздники"] },
      },
      {
        say: { text: "Оформление и праздники" },
        expect: { says: ["Небосвод писателей"], notSays: ["Палитра средств"] },
      },
    ],
  },
  {
    id: "dm-section-name-emoji-brackets-ig-ru",
    title: "название раздела без эмодзи и скобок открывает раздел каталога",
    origin:
      "AATeach 11.10 (дневной срез): «Начальная школа» ×4 и «Категоря начальная школа» после списка разделов → «Чтобы открыть, напишите номер»; раздел «🏫НАЧАЛЬНАЯ ШКОЛА (1-4 классы)»",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "aateach_buyer",
    tenantSettings: { zernio: { profile_id: "prof-1", account_ids: ["acc-1"] } },
    products: [
      { id: P1, name: "Карточки по чтению", price: 1400 },
      { id: P2, name: "Комплект ко Дню хлеба", price: 1500 },
    ],
    arrange: (r) => {
      const bot = r.db.tables.payment_methods![0]!.bot_id;
      r.db.tables.categories = [
        {
          id: "c1",
          bot_id: bot,
          name: "🏫НАЧАЛЬНАЯ ШКОЛА (1-4 классы)",
          parent_id: null,
          is_visible: true,
          sort_order: 1,
        },
        {
          id: "c2",
          bot_id: bot,
          name: "🥨День ХЛЕБА",
          parent_id: null,
          is_visible: true,
          sort_order: 2,
        },
      ];
      r.db.tables.products![0]!.category_ids = ["c1"];
      r.db.tables.products![1]!.category_ids = ["c2"];
    },
    steps: [
      {
        say: { button: "CATALOG", title: "📚 Каталог" },
        expect: { says: ["НАЧАЛЬНАЯ ШКОЛА"] },
      },
      {
        say: { text: "Начальная школа" },
        expect: {
          says: ["Карточки по чтению"],
          notSays: ["напишите номер", "Комплект ко Дню хлеба"],
        },
      },
    ],
  },
  {
    id: "dm-rule-name-beats-similar-section-ig-ru",
    title: "название правила в Direct остаётся правилом, хотя в списке есть похожий раздел",
    origin:
      "Копилка 11.10: раздел «Папки» и правило «Папка профориентатора» — неточное совпадение с разделом не должно отнимать кнопку «Купить» правила",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "kopilka_buyer",
    tenantSettings: { zernio: { profile_id: "prof-1", account_ids: ["acc-1"] } },
    products: [
      { id: P1, name: "Папка профориентатора", price: 2500 },
      { id: P2, name: "Небосвод писателей", price: 150 },
    ],
    automations: [
      {
        id: "prof",
        name: "Папка профориентатора",
        accountId: "acc-1",
        trigger: "comment",
        keywords: [],
        isActive: true,
        postTitle: "Папка профориентатора: всё для классного часа о профессиях.",
        dmMessage: "Готовая папка профориентатора — нажмите «Купить»",
        buttons: [{ type: "postback", title: "Купить", payload: `PROD:${P1}` }],
      },
    ],
    arrange: (r) => {
      const bot = r.db.tables.payment_methods![0]!.bot_id;
      r.db.tables.categories = [
        { id: "c1", bot_id: bot, name: "Папки ", parent_id: null, is_visible: true, sort_order: 1 },
        {
          id: "c2",
          bot_id: bot,
          name: "Русоведам",
          parent_id: null,
          is_visible: true,
          sort_order: 2,
        },
      ];
      r.db.tables.products![0]!.category_ids = ["c1"];
      r.db.tables.products![1]!.category_ids = ["c2"];
    },
    steps: [
      {
        say: { button: "CATALOG", title: "📚 Каталог" },
        expect: { says: ["Русоведам"] },
      },
      {
        // Сообщение правила уходит через Zernio (в сценарии без сети); магазин
        // раздел «Папки» не открывает.
        say: { text: "Папка профориентатора" },
        expect: { silent: true },
      },
      {
        say: { text: "Папки" },
        expect: { says: ["Папка профориентатора — 2500"] },
      },
    ],
  },
  {
    id: "dm-word-of-product-name-not-rule-ig-ru",
    title:
      "слово из длинного названия товара и рассказ о покупке в Direct не присылают «Купить» правила; полное название — присылает",
    origin:
      "заказ #146 Копилки русоведа 12.10 10:51 (Гульнара Асабаева): «Выразит.средства я у вас покупала» → сообщение Палитры с «Купить» → заказ на уже купленный материал",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "kopilka_buyer146",
    tenantSettings: { zernio: { profile_id: "prof-1", account_ids: ["acc-1"] } },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    automations: [
      {
        id: "pal",
        name: "Палитра",
        accountId: "acc-1",
        trigger: "comment",
        keywords: [],
        isActive: true,
        postTitle: 'Пишите в комментариях слово "Палитра" и я вышлю подробную информацию.',
        dmMessage: "Таблички к оформлению кабинета и к праздникам",
        buttons: [{ type: "postback", title: "Купить", payload: `PROD:${P1}` }],
      },
    ],
    steps: [
      {
        say: { text: "Выразит.средства я у вас покупала" },
        expect: { ruleMessages: 0 },
      },
      {
        say: { text: "средства выразительности" },
        expect: { ruleMessages: 0 },
      },
      {
        say: { text: "Хочу Палитру средств выразительности" },
        expect: { ruleMessages: 1 },
      },
    ],
  },
  // ───── Копилка 12.10, рилс «Матрёшки» (§94): оплата и выдача в переписке ─────
  {
    id: "kaspi-push-text-receipt-ig-ru",
    title:
      "текст уведомления Kaspi «Покупка: 1 700 ₸ / ИП …» — чек текстом: «Принял чек», заказ продавцу на подтверждение",
    origin:
      "Копилка 12.10, taurgalievna #148: «Оплатила», бот попросил фото чека, она вставила текст пуша Kaspi — тишина, заказ висел неоплаченным",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    triage: [{ kind: "text_receipt" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { text: "Покупка: 1 700 ₸\nИП КОПИЛКА РУСОВЕДА\nДоступно: 3 668,67 ₸" },
        expect: {
          says: [EVENING_COPY.ru.textReceiptTaken(82)],
          orders: {
            82: {
              status: "awaiting_confirmation",
              payment_proof_path: "Чек текстом",
              admin_note: expect.stringContaining("ИП КОПИЛКА РУСОВЕДА"),
            },
          },
        },
      },
    ],
  },
  {
    id: "kaspi-push-text-receipt-model-says-no-ig-ru",
    title:
      "сумма в рассказе «я перевела 1700 ₸, когда пришлёте?» — модель говорит «не чек»: заказ не трогаем",
    origin: "ожидание к kaspi-push-text-receipt-ig-ru (Копилка 12.10, #148)",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    triage: [{ kind: "other" }, { kind: "other" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: paidOrder({ status: "awaiting_payment" }),
    steps: [
      {
        say: { text: "я перевела 1700 ₸, когда пришлёте?" },
        expect: {
          notSays: [EVENING_COPY.ru.textReceiptTaken(82)],
          orders: { 82: { status: "awaiting_payment" } },
        },
      },
    ],
  },
  {
    id: "paid-by-link-then-email-ask-ig-ru",
    title:
      "оплатила по ссылке, файлы выданы, шаг «жду оплату» остался: «можно на почту?» разбирает ИИ после оплаты — спрашивает почту и шлёт письмо",
    origin:
      "Копилка 12.10, _marina_lyalina_ #149: картой РФ, выдано за 4 минуты, «А можно отправить на почту?», адрес, «Не могу скачать по ссылкам» — тишина, обращение",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    mail: true,
    postpay: [{ action: "status" }],
    state: { mode: "awaiting_payment", pending_order_id: 82, pay_link: "pdm" },
    arrange: paidOrder(),
    steps: [
      {
        say: { text: "А можно отправить на почту?" },
        expect: {
          count: 1,
          says: ["82"],
          mails: [],
          state: { mode: "awaiting_order_email", pending_order_id: 82 },
        },
      },
      {
        say: { text: "anna@mail.ru" },
        expect: { says: ["anna@mail.ru"], mails: ["anna@mail.ru"] },
      },
    ],
  },
  {
    id: "how-to-pay-resends-kaspi-step-ig-ru",
    title:
      "после «не получается» и вопроса о банке «Как перейти на оплату?» — ещё раз реквизиты Kaspi; «Каспий банк РК» следом — без второго повтора",
    origin:
      "Копилка 12.10, janat021265 #147: «Не получается» → «напишите, какой у вас банк» → «Как перейти на оплату?», «Каспий банк РК» — тишина",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    triage: [{ kind: "how_to_pay" }, { kind: "how_to_pay" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: (r) => {
      paidOrder({ status: "awaiting_payment" })(r);
      r.db.tables.orders![0]!.country_code = "KZ";
      r.db.tables.payment_methods![0]!.instructions = "Kaspi Gold 4400 4302 1234 5678, Кристина У.";
    },
    steps: [
      {
        say: { text: "Как перейти на оплату?" },
        expect: { says: ["Kaspi Gold 4400 4302 1234 5678"], state: { mode: "awaiting_proof" } },
      },
      {
        say: { text: "Каспий банк РК" },
        expect: { notSays: ["Kaspi Gold 4400 4302 1234 5678"] },
      },
    ],
  },
  {
    id: "plus-hand-sent-first-dm-ig-ru",
    title:
      "«+» на первое сообщение, отправленное вручную (в переписке Zernio его нет): вопрос «какой материал?» с «Каталогом», а не обращение",
    origin:
      "Копилка 12.10 18:29, maryyyyisaaaa: «Палитру» прислали ответом на старый комментарий «Уголок», «+» → обращение #147, «Купить» не пришла",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "2484239145397793",
    tenantSettings: { zernio: { profile_id: "prof-1", account_ids: ["acc-1"] } },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    automations: [
      {
        id: "pal",
        name: "Палитра",
        accountId: "acc-1",
        trigger: "comment",
        keywords: [],
        isActive: true,
        postTitle: 'Пишите в комментариях слово "Палитра" и я вышлю подробную информацию.',
        dmMessage: "Спасибо за интерес к материалу «Палитра средств выразительности»",
        buttons: [{ type: "postback", title: "Купить", payload: `PROD:${P1}` }],
      },
    ],
    arrange: () => {
      PLUS_WAIT.ms = 0;
    },
    steps: [
      {
        say: { text: "+" },
        expect: { says: [(c) => c.plusWhichProduct], sellerNotices: 0 },
      },
      {
        say: { text: "+" },
        expect: { notSays: [(c) => c.plusWhichProduct] },
      },
    ],
  },
  // ───── Копилка, вечер 12.10: Kaspi из Кыргызстана и «как получить» после карточки ─────
  {
    id: "kaspi-foreign-cant-pay-ig-ru",
    title:
      "покупатель раньше сказал «Я с Кыргызстана», выбрал перевод Kaspi и пишет «Не получится» — «Kaspi принимает только карты Казахстана, оплату подключаем», банк не спрашиваем, вопрос продавцу; второй раз не повторяем",
    origin:
      "Копилка 12.10 19:44, kramiliia #159: «Я с Кыргызстана. Сколько в сомах» → «Перевод Kaspi» → «Не получится» → «напишите, какой у вас банк»",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "payment_failed" }, { kind: "payment_failed" }],
    state: {
      mode: "awaiting_proof",
      pending_order_id: 82,
      direct: { foreign_country: "KG", foreign_pay_at: new Date().toISOString() },
    },
    arrange: kaspiOrder,
    steps: [
      {
        say: { text: "Не получится" },
        expect: {
          count: 1,
          says: [(c) => c.kaspiForeignReply("Кыргызстан")],
          notSays: [(c) => c.payFailedReply, "какой у вас банк"],
          sellerNotices: 1,
          orders: { 82: { status: "awaiting_payment" } },
        },
      },
      {
        say: { text: "Не получится у меня" },
        expect: { notSays: [(c) => c.kaspiForeignReply("Кыргызстан"), (c) => c.payFailedReply] },
      },
    ],
  },
  {
    id: "kaspi-foreign-said-at-pay-step-ig-ru",
    title:
      "«Я с Кыргызстана» уже на шаге перевода Kaspi — тот же честный ответ про Kaspi, а не «передал продавцу»",
    origin: "Копилка 12.10, kramiliia #159: ожидание к kaspi-foreign-cant-pay-ig-ru",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    triage: [{ kind: "foreign_pay", country: "KG" }, { kind: "payment_failed" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: kaspiOrder,
    steps: [
      {
        say: { text: "Я с Кыргызстана. Сколько в сомах" },
        expect: {
          count: 1,
          says: [(c) => c.kaspiForeignReply("Кыргызстан")],
          notSays: [(c) => c.payTroubleHandoff],
        },
      },
      {
        say: { text: "Не получится" },
        expect: { notSays: [(c) => c.payFailedReply, "какой у вас банк"] },
      },
    ],
  },
  {
    id: "kaspi-foreign-country-from-model-ig-ru",
    title:
      "страну покупателя («я из Узбекистана» раньше в переписке) называет модель — тот же честный ответ про Kaspi, без вопроса о банке",
    origin: "Копилка 12.10, _madaminova_77_ (Узбекистан): ожидание к kaspi-foreign-cant-pay-ig-ru",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    triage: [{ kind: "payment_failed", country: "UZ" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: kaspiOrder,
    steps: [
      {
        say: { text: "Не получается оплатить" },
        expect: {
          count: 1,
          says: [(c) => c.kaspiForeignReply("Узбекистан")],
          notSays: [(c) => c.payFailedReply],
        },
      },
    ],
  },
  {
    id: "kaspi-foreign-kazakhstan-asks-bank-ig-ru",
    title:
      "покупатель из Казахстана пишет «Не получится» на Kaspi — прежний ответ «попробуйте ещё раз или напишите банк»",
    origin: "граница к kaspi-foreign-cant-pay-ig-ru",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    triage: [{ kind: "payment_failed", country: "KZ" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: kaspiOrder,
    steps: [
      {
        say: { text: "Не получится" },
        expect: { says: [(c) => c.payFailedReply], notSays: ["только карты Казахстана"] },
      },
    ],
  },
  {
    id: "kaspi-foreign-switch-off-ig-ru",
    title:
      "«Отвечать про оплату из других стран» выключено — на «Не получится» из Кыргызстана прежний ответ",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    triage: [{ kind: "payment_failed", country: "KG" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: (r) => {
      kaspiOrder(r);
      r.db.tables.app_settings!.push({ key: "chat_foreign_pay", value: "false" });
    },
    steps: [
      {
        say: { text: "Не получится" },
        expect: { says: [(c) => c.payFailedReply], notSays: ["только карты Казахстана"] },
      },
    ],
  },
  {
    id: "how-to-get-after-buy-card-ig-ru",
    title:
      "после карточки с «Купить» «Как можно получить» — «нажмите «Купить»» с кнопкой, без обращения; повтор в полчаса — без второго ответа",
    origin:
      "Копилка 12.10, boranbaeva__ainur: карточка «Матрёшки» → «Здравствуйте» → обращение, «Как можно получить» → тишина",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "boranbaeva__ainur",
    triage: [{ kind: "how_to_buy" }, { kind: "how_to_buy" }],
    arrange: buySent,
    steps: [
      {
        say: { text: "Как можно получить" },
        expect: {
          count: 1,
          says: [(c) => c.howToBuyReply("Купить")],
          buttons: ["Купить"],
          sellerNotices: 0,
        },
      },
      {
        say: { text: "Как получить?" },
        expect: { notSays: [(c) => c.howToBuyReply("Купить")] },
      },
    ],
  },
  {
    id: "how-to-get-race-ig-ru",
    title:
      "«Как получить?» дважды одновременно и повтор вебхука — «нажмите «Купить»» уходит один раз",
    origin: "CLAUDE.md «Один раз»: двойная доставка, два сообщения подряд",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "boranbaeva__ainur",
    triage: [{ kind: "how_to_buy" }, { kind: "how_to_buy" }, { kind: "how_to_buy" }],
    arrange: buySent,
    steps: [
      {
        say: { burst: ["Как можно получить", "Как получить?"] },
        expect: { count: 1, says: [(c) => c.howToBuyReply("Купить")] },
      },
      { say: { repeat: true }, expect: { silent: true } },
    ],
  },
  {
    id: "how-to-get-no-buy-card-ig-ru",
    title:
      "«Как можно получить» без карточки с «Купить» — бот не отвечает за продавца, вопрос продавцу",
    origin: "граница к how-to-get-after-buy-card-ig-ru",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "how_to_buy" }],
    steps: [
      {
        say: { text: "Как можно получить" },
        expect: { notSays: [(c) => c.howToBuyReply("Купить")], sellerNotices: 1 },
      },
    ],
  },
  {
    id: "how-to-get-while-unpaid-ig-ru",
    title:
      "заказ уже ждёт оплату — «как получить?» не зовёт снова нажать «Купить» (вопросы об оплате разбирает шаг оплаты, #109)",
    origin: "граница к how-to-get-after-buy-card-ig-ru и #109",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    username: "boranbaeva__ainur",
    triage: [{ kind: "how_to_buy" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: (r) => {
      kaspiOrder(r);
      buySent(r);
    },
    steps: [
      {
        say: { text: "Как можно получить" },
        expect: { notSays: [(c) => c.howToBuyReply("Купить")] },
      },
    ],
  },
  {
    id: "how-to-get-switch-off-ig-ru",
    title: "«Отвечать на «как получить?»» выключено — вопрос уходит продавцу, как раньше",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "boranbaeva__ainur",
    triage: [{ kind: "how_to_buy" }],
    arrange: (r) => {
      buySent(r);
      r.db.tables.app_settings!.push({ key: "chat_how_to_buy", value: "false" });
    },
    steps: [
      {
        say: { text: "Как можно получить" },
        expect: { notSays: [(c) => c.howToBuyReply("Купить")], sellerNotices: 1 },
      },
    ],
  },
  // ───── Копилка, утро 13.10: два материала одним чеком, название без правила, Кыргызстан и «Купить» ─────
  {
    id: "several-items-one-receipt-ig-ru",
    title:
      "на шаге оплаты «Можно вот эти 2 материала одним чеком» — «вопрос уже у продавца», обращение; повтор — без второго ответа",
    origin:
      "Копилка 13.10, gvar41391 #190 «Спряжение глаголов»: «Картой РФ» → «Можно вот эти 2 материала одним чеком» → тишина",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "several_items" }, { kind: "several_items" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: kaspiOrder,
    steps: [
      {
        say: { text: "Можно вот эти 2 материала одним чеком" },
        expect: {
          count: 1,
          says: [(c) => c.severalItemsReply],
          sellerNotices: 1,
          orders: { 82: { status: "awaiting_payment" } },
          state: { mode: "awaiting_proof" },
        },
      },
      {
        say: { text: "Два материала можно одним чеком?" },
        expect: { silent: true },
      },
    ],
  },
  {
    id: "several-items-idle-ig-ru",
    title: "без заказа «хочу оба, можно одной оплатой?» — тот же ответ «вопрос уже у продавца»",
    origin: "ожидание к several-items-one-receipt-ig-ru",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "several_items" }],
    steps: [
      {
        say: { text: "хочу оба, можно одной оплатой?" },
        expect: { count: 1, says: [(c) => c.severalItemsReply], sellerNotices: 1 },
      },
    ],
  },
  {
    id: "several-items-switch-off-ig-ru",
    title:
      "«Отвечать на «несколько материалов одним чеком?»» выключено — бот молчит, вопрос продавцу",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "several_items" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: (r) => {
      kaspiOrder(r);
      r.db.tables.app_settings!.push({ key: "chat_several_items", value: "false" });
    },
    steps: [
      {
        say: { text: "Можно вот эти 2 материала одним чеком" },
        expect: { notSays: [(c) => c.severalItemsReply], sellerNotices: 1 },
      },
    ],
  },
  // ───── AATeach 15.10: «Не отвечать на обычные сообщения» — диалог остаётся непрочитанным ─────
  {
    id: "keep-unread-several-items-ig-ru",
    title:
      "«Не отвечать на обычные сообщения» включено: «Хотела бы купить данные материалы» — бот молчит, вопрос продавцу обращением",
    origin:
      "AATeach 15.10, lenchik_ashotovna: четыре картинки и «Здравствуйте! Хотела бы купить, данные материалы.» → «Ваш вопрос уже у продавца: … можно ли оплатить несколько материалов одним чеком»; ответ пометил диалог прочитанным, Анастасия его не увидела",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "several_items" }],
    arrange: (r) => {
      r.db.tables.app_settings!.push({ key: "chat_keep_unread", value: "true" });
    },
    steps: [
      {
        say: { text: "Здравствуйте! Хотела бы купить, данные материалы." },
        expect: { silent: true, sellerNotices: 1 },
      },
    ],
  },
  {
    id: "keep-unread-product-request-foreign-ig-ru",
    title:
      "«Не отвечать на обычные сообщения» включено: название материала и «в бел. руб можно?» — без ответа, вопрос продавцу",
    origin: "AATeach 15.10: 16 ответов «вопрос уже у продавца» за 4 дня, все на первое сообщение",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "product_request" }, { kind: "foreign_pay", country: "BY" }],
    arrange: (r) => {
      r.db.tables.app_settings!.push({ key: "chat_keep_unread", value: "true" });
    },
    steps: [
      {
        say: { text: "Классный уголок" },
        expect: { silent: true, sellerNotices: 1 },
      },
      {
        say: { text: "В бел. руб можно" },
        expect: { silent: true },
      },
    ],
  },
  {
    id: "keep-unread-scope-all-ig-ru",
    title:
      "«На все сообщения» и «Не отвечать на обычные сообщения» — вопрос без ответа, «Передал ваш вопрос продавцу» не уходит",
    origin: "AATeach 15.10: переключатель обещает непрочитанный диалог и при «На все сообщения»",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { manager_chat: true },
    triage: [{ kind: "other" }],
    arrange: (r) => {
      r.db.tables.app_settings!.push(
        { key: "chat_keep_unread", value: "true" },
        { key: "instagram_direct_bot_scope", value: "all" },
      );
    },
    steps: [
      {
        say: { text: "А когда будут новые материалы по чтению?" },
        expect: { silent: true },
      },
    ],
  },
  {
    id: "keep-unread-pay-step-still-answers-ig-ru",
    title:
      "«Не отвечать на обычные сообщения» включено, а заказ ждёт оплату: «Не проходит» — бот по-прежнему отвечает про платёж",
    origin: "ожидание к keep-unread-several-items-ig-ru: шаг оплаты переключатель не трогает",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    mail: true,
    receipts: true,
    triage: [{ kind: "payment_failed" }],
    state: { mode: "awaiting_proof", pending_order_id: 82 },
    arrange: (r) => {
      paidOrder({ status: "awaiting_payment" })(r);
      r.db.tables.app_settings!.push({ key: "chat_keep_unread", value: "true" });
    },
    steps: [
      {
        say: { text: "Не проходит" },
        expect: { count: 1, says: [(c) => c.payFailedReply] },
      },
    ],
  },
  {
    id: "product-request-no-rule-ig-ru",
    title:
      "название материала без правила и товара («Классный уголок») — один ответ «вопрос у продавца» с «Каталогом», обращение; ещё три раза подряд — без ответа",
    origin:
      "Копилка 13.10: «Классный уголок» 4 раза подряд — обращение №173 и тишина; «Материал для доски» — тоже",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [
      { kind: "product_request" },
      { kind: "product_request" },
      { kind: "product_request" },
      { kind: "product_request" },
    ],
    steps: [
      {
        say: { text: "Классный уголок" },
        expect: {
          count: 1,
          says: [(c) => c.productRequestReply],
          buttons: ["📚 Каталог"],
          sellerNotices: 1,
        },
      },
      { say: { text: "Классный уголок " }, expect: { silent: true } },
      { say: { text: "Классный уголок!" }, expect: { silent: true } },
      { say: { text: "классный уголок" }, expect: { silent: true } },
    ],
  },
  {
    id: "product-request-burst-ig-ru",
    title: "«Классный уголок» дважды одновременно и повтор вебхука — ответ уходит один раз",
    origin: "CLAUDE.md «Один раз»: двойная доставка, два сообщения подряд",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "product_request" }, { kind: "product_request" }, { kind: "product_request" }],
    steps: [
      {
        say: { burst: ["Классный уголок", "Классный уголок!"] },
        expect: { count: 1, says: [(c) => c.productRequestReply] },
      },
      { say: { repeat: true }, expect: { silent: true } },
    ],
  },
  {
    id: "product-request-switch-off-ig-ru",
    title:
      "«Отвечать на название материала, которого нет в боте» выключено — бот молчит, вопрос продавцу",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    products: PRODUCTS,
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    triage: [{ kind: "product_request" }],
    arrange: (r) => {
      r.db.tables.app_settings!.push({ key: "chat_product_request", value: "false" });
    },
    steps: [
      {
        say: { text: "Материал для доски" },
        expect: { notSays: [(c) => c.productRequestReply], sellerNotices: 1 },
      },
    ],
  },
  {
    id: "foreign-buyer-buy-no-kaspi-ig-ru",
    title:
      "покупатель из Кыргызстана уже получил «оплату подключаем» и жмёт «Купить» — заказ оформлен без Kaspi и «Картой РФ», «продавец напишет», продавцу — уведомление; повторное «Купить» — тот же ответ, дальше тишина",
    origin:
      "Копилка 13.10, #188: «Сколько будет в сомах?+» → «оплату из вашей страны подключаем» → «Купить» → кнопки Kaspi и «Картой РФ»",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Матрешки" }],
    state: KG_SAID,
    arrange: prodamusOn,
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: {
          count: 1,
          says: [/Заказ №\d+ оформлен\. Оплату из вашей страны \(Кыргызстан\) сейчас подключаем/],
          notSays: ["К оплате", "Kaspi", "Картой РФ", "4400 4302"],
          noButtons: [/Kaspi/, /Картой РФ/, /Перевод/],
          sellerNotices: 1,
          state: { mode: "awaiting_proof" },
        },
      },
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: {
          count: 1,
          says: [/Оплату из вашей страны \(Кыргызстан\)/],
          notSays: ["реквизиты в сообщении выше", "4400 4302", "Картой РФ"],
          sellerNotices: 0,
        },
      },
      { say: { button: `PROD:${P1}`, title: "Купить" }, expect: { silent: true } },
    ],
  },
  {
    id: "foreign-buyer-buy-kazakhstan-ig-ru",
    title:
      "покупатель без сказанной страны жмёт «Купить» — прежний выбор оплаты с Kaspi и «Картой РФ»",
    origin: "граница к foreign-buyer-buy-no-kaspi-ig-ru",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Матрешки" }],
    state: {},
    arrange: prodamusOn,
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { count: 1, says: ["К оплате", "Картой РФ"], notSays: ["Оплату из вашей страны"] },
      },
    ],
  },
  {
    id: "foreign-buyer-buy-switch-off-ig-ru",
    title:
      "«Отвечать про оплату из других стран» выключено — «Купить» у покупателя из Кыргызстана показывает оплату, как раньше",
    origin: "Яков 11.10: новое поведение бота — переключатель в настройках",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Матрешки" }],
    state: KG_SAID,
    arrange: (r) => {
      prodamusOn(r);
      r.db.tables.app_settings!.push({ key: "chat_foreign_pay", value: "false" });
    },
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { count: 1, says: ["К оплате"], notSays: ["Оплату из вашей страны"] },
      },
    ],
  },
  {
    id: "foreign-buyer-buy-method-exists-ig-ru",
    title:
      "у магазина появился способ оплаты для Кыргызстана — «Купить» ведёт обычным путём, без «оплату подключаем»",
    origin: "граница к foreign-buyer-buy-no-kaspi-ig-ru: Робокасса подключена",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Матрешки" }],
    state: KG_SAID,
    arrange: (r) => {
      prodamusOn(r);
      r.db.tables.payment_methods!.push({
        id: "pm-kg",
        bot_id: r.db.tables.payment_methods![0]!.bot_id,
        is_active: true,
        sort_order: 3,
        country_code: "KG",
        country_name: "Кыргызстан",
        currency: "KZT",
        instructions: "Перевод на карту Элкарт 9417 0000 0000 0000",
      });
    },
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { notSays: ["Оплату из вашей страны"] },
      },
    ],
  },
  {
    id: "express-buy-after-delivered-ig-ru",
    title:
      "«Купить» по товару, чей заказ только что выдан, — второго заказа нет: «материал у вас уже есть, заказ #221 выдан»; повтор — тишина",
    origin: "Копилка 14.10, aliyajanaman #221/#222",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Матрешки", price: 1700 }],
    state: {},
    arrange: boughtOrder("delivered"),
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: {
          count: 1,
          says: ["Этот материал у вас уже есть: заказ #221 выдан — файлы в сообщениях выше"],
          notSays: ["К оплате", "способ оплаты"],
          noButtons: [/Kaspi/, /Картой/],
          cart: 0,
          orderCount: 1,
        },
      },
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { silent: true, orderCount: 1 },
      },
      {
        say: { text: "Я заплатила уже" },
        expect: { notSays: ["Выберите способ оплаты", "К оплате"], orderCount: 1 },
      },
    ],
  },
  {
    id: "express-buy-under-review-ig-ru",
    title:
      "«Купить» по товару, чей чек уже у продавца на проверке, — второго заказа нет: «чек по заказу #221 уже на проверке»",
    origin: "Копилка 14.10, aliyajanaman #221/#222; там же #9 (чек на проверке) → #15",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Матрешки", price: 1700 }],
    state: {},
    arrange: boughtOrder("awaiting_confirmation"),
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: {
          count: 1,
          says: [
            "Чек по заказу #221 уже у продавца на проверке — файлы придут сюда после подтверждения",
          ],
          notSays: ["К оплате", "способ оплаты"],
          orderCount: 1,
        },
      },
    ],
  },
  {
    id: "express-buy-old-delivered-ig-ru",
    title:
      "заказ того же товара выдан больше трёх дней назад — «Купить» оформляет новый, как раньше",
    origin: "граница к express-buy-after-delivered-ig-ru",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true, prodamus: true },
    products: [{ id: P1, name: "Матрешки", price: 1700 }],
    state: {},
    arrange: boughtOrder("delivered", 4 * 24 * 60),
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: { says: ["К оплате"], notSays: ["у вас уже есть"], orderCount: 2 },
      },
    ],
  },
  {
    id: "code-word-then-plus-after-card-ig-ru",
    title:
      "кодовое слово в ответ на первое сообщение отдаёт карточку без обращения; «+» и «++» после карточки зовут нажать «Купить»",
    origin:
      "срез 137, kunsulu518 (Копилка 15.10 20:56): «Палитра» → карточка с «Купить» и «Ваш вопрос уже у продавца» (обращение №205), «+» следом — тишина",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "kunsulu518",
    tenantSettings: { zernio: { profile_id: "prof-1", account_ids: ["acc-1"] } },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    automations: [PALITRA_RULE],
    arrange: palitraPending("kunsulu518"),
    steps: [
      {
        say: { text: "Палитра" },
        expect: {
          ruleMessages: 1,
          silent: true,
          sellerNotices: 0,
        },
      },
      {
        say: { text: "+" },
        expect: {
          count: 1,
          says: ["нажмите «Купить» под сообщением"],
          notSays: ["уже у продавца", "какой материал"],
          buttons: ["Купить"],
          sellerNotices: 0,
          ruleMessages: 0,
        },
      },
      {
        // Второй «+» сразу следом — тот же призыв уже ушёл, второй раз не шлём.
        say: { text: "++" },
        expect: { silent: true, sellerNotices: 0, ruleMessages: 0 },
      },
    ],
  },
  {
    id: "plus-plus-to-first-dm-ig-ru",
    title: "«++» в ответ на первое сообщение правила — как «+»: быстрая покупка, без обращения",
    origin: "срез 137, zaure.7171 (#227): «++» после первого сообщения",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "zaure.7171",
    tenantSettings: { zernio: { profile_id: "prof-1", account_ids: ["acc-1"] } },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    automations: [PALITRA_RULE],
    arrange: palitraPending("zaure.7171"),
    steps: [
      {
        say: { text: "++" },
        expect: { ruleMessages: 1, says: ["К оплате"], orderCount: 1, sellerNotices: 0 },
      },
    ],
  },
  {
    id: "code-word-after-card-sent-ig-ru",
    title:
      "кодовое слово уже после карточки (её отдал вебхук комментария) — «нажмите «Купить»», без обращения и второй карточки",
    origin: "срез 137, kunsulu518: граница — карточка ушла раньше, чем пришло слово",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "kunsulu518",
    tenantSettings: { zernio: { profile_id: "prof-1", account_ids: ["acc-1"] } },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    automations: [PALITRA_RULE],
    arrange: palitraSent("kunsulu518", 20_000),
    steps: [
      {
        say: { text: "Палитра" },
        expect: {
          count: 1,
          says: ["нажмите «Купить» под сообщением"],
          notSays: ["уже у продавца"],
          buttons: ["Купить"],
          sellerNotices: 0,
          // Строка кодового слова закрывается как «уже отправлено» — без второй карточки.
        },
      },
    ],
  },
  {
    id: "plus-long-after-card-ig-ru",
    title: "«+» через час после карточки — не ответ на неё: призыв «нажмите «Купить»» не шлём",
    origin: "граница к code-word-then-plus-after-card-ig-ru",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "kunsulu518",
    tenantSettings: { zernio: { profile_id: "prof-1", account_ids: ["acc-1"] } },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    automations: [PALITRA_RULE],
    arrange: palitraSent("kunsulu518", 60 * 60_000),
    steps: [
      {
        say: { text: "+" },
        expect: { notSays: ["нажмите «Купить» под сообщением"], ruleMessages: 0 },
      },
    ],
  },
  {
    id: "code-word-question-after-card-ig-ru",
    title:
      "вопрос с кодовым словом («Палитра на казахском есть?») — карточка и вопрос продавцу, не молчание",
    origin: "граница к code-word-then-plus-after-card-ig-ru",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    username: "kunsulu518",
    tenantSettings: { zernio: { profile_id: "prof-1", account_ids: ["acc-1"] } },
    products: [{ id: P1, name: "Палитра средств выразительности", price: 1700 }],
    automations: [PALITRA_RULE],
    arrange: palitraPending("kunsulu518"),
    steps: [
      {
        say: { text: "Палитра на казахском есть?" },
        expect: { ruleMessages: 1, sellerNotices: 1 },
      },
    ],
  },
  {
    id: "consultant-direct-checkout-wa-ru",
    title:
      "консультант в WhatsApp: при согласии купить («Да. Давайте оформим») сразу оформляет заказ и присылает оплату, а не зовёт в каталог",
    origin:
      "Копилка Русоведа 21.10: клиент спросил про лестницы и согласился купить, бот звал писать «каталог»",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { whatsapp: true, wa_shop: true },
    consultant: "Отлично, оформляю заказ! Счёт на оплату формируется...",
    consultantOrder: { productName: "Прописи" },
    products: PRODUCTS,
    steps: [
      {
        say: { text: "Да. Давайте оформим" },
        expect: {
          says: [
            "Отлично, оформляю заказ! Счёт на оплату формируется...",
            "Заказ #",
            "018. Прописи",
            (c) => c.afterProofManual,
          ],
          notSays: ["напишите «каталог»", "напишите каталог"],
        },
      },
    ],
  },
  {
    id: "consultant-selection-is-not-purchase-wa-ru",
    title: "короткий выбор папки в ответ на уточнение не становится заявкой или заказом",
    origin:
      "Копилка Русоведа 24.10: на «МО для Казахстана» после уточнения выбора бот ответил «Записываю к заказу» и передал заявку менеджеру",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { whatsapp: true, wa_shop: true },
    state: {
      consultant: {
        recent: [
          {
            role: "assistant",
            text: "Папка МО классных руководителей для Казахстана — 2500 KZT. Какая папка вам нужна?",
          },
        ],
      },
    },
    consultant: "Записываю к заказу: Папка МО классных руководителей для Казахстана — 2500 KZT.",
    products: PRODUCTS,
    steps: [
      {
        say: { text: "МО для Казахстана" },
        expect: {
          says: ["Пока заказ не оформлен"],
          notSays: ["Записываю к заказу", "передал менеджеру"],
          orderCount: 0,
          tasks: [],
        },
      },
    ],
  },
  {
    id: "consultant-honesty-no-order-wa-ru",
    title:
      "без активного заказа продавец не обещает материалы после чека и не просит оплатить заранее",
    origin:
      "Копилка Русоведа 24.10: на «А это точно честно?» бот обещал материалы после чека и личный контроль при mode=idle без созданного заказа",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { whatsapp: true, wa_shop: true },
    consultant:
      "Да, честно. Мы сразу высылаем материалы после чека. Можете сначала оплатить, а чек прислать сюда — я прослежу.",
    products: PRODUCTS,
    steps: [
      {
        say: { text: "А это точно честно?" },
        expect: {
          says: ["деньги или чек"],
          notSays: ["высылаем материалы после чека", "я прослежу", "можете сначала оплатить"],
          orderCount: 0,
          tasks: [],
        },
      },
    ],
  },
  {
    id: "consultant-no-false-order-wa-ru",
    title: "вопрос о наличии в WhatsApp не превращается в ложное обещание оформить заказ",
    origin:
      "Копилка Русоведа, тест Якова 24.10: на «У вас есть папка классного руководителя?» бот ответил «Оформляю заказ — детали и оплата сейчас появятся»",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { whatsapp: true, wa_shop: true },
    consultant: "Оформляю заказ — детали и оплата сейчас появятся в этом чате.",
    products: PRODUCTS,
    steps: [
      {
        say: { text: "Здравствуйте. У вас есть папка классного руководителя?" },
        expect: {
          says: ["Пока заказ не оформлен"],
          notSays: ["Оформляю заказ", "детали и оплата сейчас появятся"],
          orderCount: 0,
        },
      },
    ],
  },
  {
    id: "consultant-buy-button-without-text-wa-ru",
    title:
      "модель поставила кнопку «Купить» без текста — бот дописывает ответ, а не шлёт «Уточните, что вас интересует»",
    origin:
      "Копилка Русоведа, WhatsApp 23.10 12:29: на «Да, оформляем» бот четыре раза ответил «Уточните, пожалуйста, что именно вас интересует»; набор продаж #164 26.10 нашёл ту же заготовку под кнопкой «Купить», когда модель вызвала инструмент без текста",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    modules: { whatsapp: true, wa_shop: true },
    products: [
      {
        id: "13f5415b-d628-433e-b9ec-03d15b801ea0",
        name: "Лестницы «Части речи и члены предложения»",
        price: 2000,
      },
    ],
    triage: [{ kind: "product_request" }],
    consultantRounds: [
      [
        {
          type: "tool_use",
          id: "t1",
          name: "offer_buy_button",
          input: { product_id: "13f5415b-d628-433e-b9ec-03d15b801ea0" },
        },
      ],
      [{ type: "text", text: "Лестницы для кабинета на А4, 2 000 ₸." }],
    ],
    steps: [
      {
        say: { text: "Здравствуйте. Интересуют лестницы «Части речи и члены предложения»." },
        expect: {
          says: ["Лестницы для кабинета"],
          notSays: ["что именно вас интересует"],
          buttons: ["🛒 Купить"],
        },
      },
    ],
  },
  {
    id: "consultant-buy-button-press-hint-wa-ru",
    title:
      "под кнопкой «Купить» модель пишет «нажмите, чтобы оформить заказ» — ответ уходит как есть, без «Пока заказ не оформлен»",
    origin:
      "Набор продаж 26.10 (Копилка, «Папка МО ЕМН → для Казахстана»): ответ «Нажмите кнопку «Купить» ниже, чтобы оформить заказ и получить ссылку на оплату» фильтр принял за обещание заказа и заменил на «Пока заказ не оформлен. Что именно вы хотели узнать о товаре?»",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    modules: { whatsapp: true, wa_shop: true },
    products: [
      {
        id: "13f5415b-d628-433e-b9ec-03d15b801ea0",
        name: "Папка МО ЕМН",
        price: 3500,
      },
    ],
    triage: [{ kind: "product_request" }],
    consultantRounds: [
      [
        { type: "text", text: "Папка МО ЕМН — 3 500 ₸. Нажмите «Купить», чтобы оформить заказ." },
        {
          type: "tool_use",
          id: "t1",
          name: "offer_buy_button",
          input: { product_id: "13f5415b-d628-433e-b9ec-03d15b801ea0" },
        },
      ],
      [{ type: "text", text: "" }],
    ],
    steps: [
      {
        say: { text: "Документация (папка) МО ЕМН интересует. Что стоит?" },
        expect: {
          says: ["Нажмите «Купить», чтобы оформить заказ"],
          notSays: ["Пока заказ не оформлен"],
          buttons: ["🛒 Купить"],
          orderCount: 0,
        },
      },
    ],
  },
  {
    id: "consultant-want-to-buy-places-order-wa-ru",
    title:
      "«Хотела купить …» — заказ оформляет модель, бот не переспрашивает «что вы хотели узнать»",
    origin:
      "Копилка Русоведа, WhatsApp 25.10 11:50: на «Хотела купить папку» и «Что туда входит?» бот дважды ответил «Пока заказ не оформлен. Что именно вы хотели узнать о товаре?» — фильтр по словам прятал от модели оформление заказа",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { whatsapp: true, wa_shop: true },
    consultant: "Оформляю прописи.",
    consultantOrder: { productName: "018. Прописи" },
    products: PRODUCTS,
    steps: [
      {
        say: { text: "Хотела купить прописи" },
        expect: {
          says: ["Оформляю прописи"],
          notSays: ["Что именно вы хотели узнать"],
          orderCount: 1,
        },
      },
    ],
  },
  {
    id: "consultant-controls-order-cancellation-wa-ru",
    title: "активную отмену решает AI-консультант, а не автоматический роутер магазина",
    origin:
      "Регрессия 25.10: при просьбе отменить заказ магазин отменял неоплаченный заказ до того, как консультант мог уточнить номер и выбрать действие",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { whatsapp: true, wa_shop: true },
    state: { mode: "awaiting_payment", pending_order_id: 7, pending_display_no: 270 },
    arrange: (r) => {
      r.db.tables.orders!.push({
        id: 7,
        bot_id: "00000000-0000-4000-8000-0000000000aa",
        order_no: 7,
        display_no: 270,
        telegram_id: -1,
        status: "awaiting_payment",
        paid_amount: 0,
        fulfillment_kind: "digital",
        order_items: [],
      });
    },
    consultant: "Уточните, пожалуйста, номер заказа, который хотите отменить.",
    steps: [
      {
        say: { text: "Отмени, пожалуйста" },
        expect: {
          says: ["номер заказа"],
          notSays: ["Заказ #270 отменён"],
          orderCount: 1,
          orders: { 7: { status: "awaiting_payment" } },
          state: { mode: "awaiting_payment", pending_order_id: 7 },
          tasks: [],
        },
      },
    ],
  },
  {
    id: "consultant-cancel-number-reply-bypasses-checkout-wa-ru",
    title: "номер отменяемого заказа после уточнения ИИ не перехватывается checkout",
    origin:
      "Регрессия 25.10: после вопроса ИИ «какой заказ отменить?» ответ 270 при awaiting_payment мог попасть в обработчик оплаты вместо консультанта",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { whatsapp: true, wa_shop: true },
    state: {
      mode: "awaiting_payment",
      pending_order_id: 7,
      pending_display_no: 270,
      consultant: {
        recent: [
          { role: "customer", text: "Отмени, пожалуйста" },
          { role: "assistant", text: "Уточните номер заказа, который хотите отменить." },
        ],
      },
    },
    arrange: (r) => {
      r.db.tables.orders!.push({
        id: 7,
        bot_id: "00000000-0000-4000-8000-0000000000aa",
        order_no: 7,
        display_no: 270,
        telegram_id: -1,
        status: "awaiting_payment",
        paid_amount: 0,
        fulfillment_kind: "digital",
        order_items: [],
      });
    },
    consultant: "Спасибо, уточняю.",
    steps: [
      {
        say: { text: "270" },
        expect: {
          says: ["Спасибо, уточняю"],
          orderCount: 1,
          orders: { 7: { status: "awaiting_payment" } },
          state: { mode: "awaiting_payment", pending_order_id: 7 },
          tasks: [],
        },
      },
    ],
  },
  {
    id: "consultant-cancel-confirmation-yes-wa-ru",
    title:
      "«Да» на вопрос ИИ «Отменить заказ №270?» отменяет неоплаченный заказ, а не уходит в оплату",
    origin:
      "Копилка Русоведа, WhatsApp 24–25.10 (заказ #270): покупательница трижды просила отменить заказ, бот отвечал «Статус заказа не изменён» и «не вижу активного заказа», и она оформила второй (#272)",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { whatsapp: true, wa_shop: true },
    state: {
      mode: "awaiting_payment",
      pending_order_id: 7,
      pending_display_no: 270,
      consultant: {
        recent: [
          { role: "customer", text: "Давайте отменим заказ" },
          {
            role: "assistant",
            text: "У вас неоплаченный заказ №270 — Папка МО. Отменить его?",
          },
        ],
      },
    },
    arrange: (r) => {
      r.db.tables.orders!.push({
        id: 7,
        bot_id: "00000000-0000-4000-8000-0000000000aa",
        order_no: 7,
        display_no: 270,
        telegram_id: -1,
        status: "awaiting_payment",
        paid_amount: 0,
        fulfillment_kind: "digital",
        order_items: [],
      });
    },
    consultantRounds: [
      [{ type: "tool_use", id: "t1", name: "cancel_my_order", input: { order_number: 270 } }],
      [{ type: "text", text: "Заказ №270 отменён." }],
    ],
    steps: [
      {
        say: { text: "Да" },
        expect: {
          says: ["Заказ №270 отменён"],
          notSays: ["не изменён"],
          orderCount: 1,
          orders: { 7: { status: "cancelled" } },
        },
      },
    ],
  },
  {
    id: "consultant-cancel-without-number-finds-order-wa-ru",
    title:
      "«Давайте отменим заказ» без номера — ИИ сам находит неоплаченный заказ и спрашивает «Отменить №270?»",
    origin:
      "Копилка Русоведа, WhatsApp 24.10 17:07 (заказ #270): на «Давайте отменим заказ» бот не нашёл заказ, а на следующий день ответил «не вижу привязанного активного заказа»",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    vertical: "consultant",
    modules: { whatsapp: true, wa_shop: true },
    state: { mode: "awaiting_payment", pending_order_id: 7, pending_display_no: 270 },
    arrange: (r) => {
      r.db.tables.orders!.push({
        id: 7,
        bot_id: "00000000-0000-4000-8000-0000000000aa",
        order_no: 7,
        display_no: 270,
        telegram_id: -1,
        status: "awaiting_payment",
        paid_amount: 0,
        fulfillment_kind: "digital",
        order_items: [],
      });
    },
    consultantRounds: [
      [{ type: "tool_use", id: "t1", name: "get_my_order_status", input: {} }],
      [{ type: "text", text: "У вас неоплаченный заказ №270 — Папка МО. Отменить его?" }],
    ],
    steps: [
      {
        say: { text: "Давайте отменим заказ" },
        expect: {
          says: ["Отменить его?"],
          notSays: ["Не нашёл заказа", "не изменён"],
          orderCount: 1,
          orders: { 7: { status: "awaiting_payment" } },
        },
      },
    ],
  },
  {
    id: "robokassa-link-no-button-wording-wa-ru",
    title:
      "WhatsApp, «Оплата картой» (Robokassa): ссылка текстом, без «Нажмите кнопку» — кнопки нет",
    origin:
      "Копилка Русоведа, WhatsApp 27.10 12:50, заказ #273: «Нажмите кнопку, оплатите картой», а под текстом только ссылка Robokassa (Яков, скриншот)",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    modules: { whatsapp: true, wa_shop: true, robokassa: true },
    state: { mode: "choose_pay", pending_order_id: 7, pending_display_no: 273 },
    arrange: (r) => {
      r.db.tables.orders!.push({
        id: 7,
        bot_id: "00000000-0000-4000-8000-0000000000aa",
        order_no: 7,
        display_no: 273,
        telegram_id: -1,
        status: "awaiting_payment",
        total: 3500,
        currency: "KZT",
        country_code: "KZ",
        paid_amount: 0,
        fulfillment_kind: "digital",
        order_items: [],
      });
      r.db.tables.app_settings!.push(
        { key: "robokassa_enabled", value: "true" },
        { key: "robokassa_login", value: "kopilka_rusoveda" },
        { key: "robokassa_pass1", value: "p1" },
        { key: "robokassa_pass2", value: "p2" },
        { key: "robokassa_region", value: "kz" },
      );
    },
    steps: [
      {
        say: { button: "PAY:rk", title: "Оплата картой" },
        expect: {
          says: ["https://auth.robokassa.kz", "Откройте ссылку"],
          notSays: ["Нажмите кнопку", "по кнопке"],
          state: { mode: "awaiting_payment", pay_link: "rk" },
        },
      },
    ],
  },
  {
    id: "kaspi-link-no-button-wording-wa-ru",
    title:
      "WhatsApp, реквизиты — ссылка pay.kaspi.kz: «Откройте ссылку», а не «Нажмите кнопку ниже»",
    origin:
      "Копилка Русоведа 27.10: в WhatsApp ссылка оплаты идёт текстом без кнопки, а подсказка звала нажать кнопку (тот же текст, что у заказа #273)",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    modules: { whatsapp: true, wa_shop: true },
    state: { mode: "choose_pay", pending_order_id: 7, pending_display_no: 273 },
    arrange: (r) => {
      r.db.tables.orders!.push({
        id: 7,
        bot_id: "00000000-0000-4000-8000-0000000000aa",
        order_no: 7,
        display_no: 273,
        telegram_id: -1,
        status: "awaiting_payment",
        total: 3500,
        currency: "KZT",
        country_code: "KZ",
        paid_amount: 0,
        fulfillment_kind: "digital",
        order_items: [],
      });
      r.db.tables.payment_methods![0]!.instructions = "https://pay.kaspi.kz/pay/fpf1rhkt";
    },
    steps: [
      {
        say: { button: "PAY:manual", title: "🧾 Перевод Kaspi" },
        expect: {
          says: ["https://pay.kaspi.kz/pay/fpf1rhkt", "Откройте ссылку", "чека"],
          notSays: ["Нажмите кнопку"],
        },
      },
    ],
  },
  {
    id: "handoff-pay-button-still-works-wa-ru",
    title:
      "WhatsApp, после передачи менеджеру: «💳 Оплата картой» по-прежнему даёт ссылку на оплату, а не тишину",
    origin:
      "Копилка Русоведа, WhatsApp 28.10 16:24, заказ #274 (Djami): консультант передал «Выставите счёт / Халык» менеджеру, «Чат» перехватил диалог, нажатие «Оплата картой» осталось без ответа, потом «Могу переводом», «???»",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    modules: { whatsapp: true, wa_shop: true, robokassa: true, manager_chat: true },
    state: { mode: "choose_pay", pending_order_id: 7, pending_display_no: 274 },
    arrange: (r) => {
      r.db.tables.orders!.push({
        id: 7,
        bot_id: "00000000-0000-4000-8000-0000000000aa",
        order_no: 7,
        display_no: 274,
        telegram_id: -1,
        status: "awaiting_payment",
        total: 3500,
        currency: "KZT",
        country_code: "KZ",
        paid_amount: 0,
        fulfillment_kind: "digital",
        order_items: [],
      });
      // Консультант передал вопрос менеджеру: «Чат» подключён (notifyHandoff → connect).
      r.db.tables.manager_chat_state!.push({
        bot_id: "00000000-0000-4000-8000-0000000000aa",
        telegram_id: -1,
        active: true,
      });
      r.db.tables.app_settings!.push(
        { key: "robokassa_enabled", value: "true" },
        { key: "robokassa_login", value: "kopilka_rusoveda" },
        { key: "robokassa_pass1", value: "p1" },
        { key: "robokassa_pass2", value: "p2" },
        { key: "robokassa_region", value: "kz" },
      );
    },
    steps: [
      {
        say: { button: "PAY:rk", title: "💳 Оплата картой" },
        expect: {
          says: ["https://auth.robokassa.kz"],
          state: { mode: "awaiting_payment", pay_link: "rk" },
        },
      },
    ],
  },
  {
    id: "handoff-my-orders-button-still-works-wa-ru",
    title: "WhatsApp, после передачи менеджеру: «📋 Мои заказы» показывает заказы, а не тишину",
    origin:
      "Копилка Русоведа, WhatsApp 28.10 16:35, заказ #274 (Djami): после выдачи файлов нажала «📋 Мои заказы» — тишина, «Чат» держал диалог у менеджера",
    channel: "whatsapp",
    locale: "ru",
    full: true,
    modules: { whatsapp: true, wa_shop: true, manager_chat: true },
    arrange: (r) => {
      r.db.tables.orders!.push({
        id: 7,
        bot_id: "00000000-0000-4000-8000-0000000000aa",
        order_no: 7,
        display_no: 274,
        telegram_id: -1,
        status: "awaiting_payment",
        total: 3500,
        currency: "KZT",
        country_code: "KZ",
        paid_amount: 0,
        fulfillment_kind: "digital",
        order_items: [],
      });
      // Консультант передал вопрос менеджеру: «Чат» подключён (notifyHandoff → connect).
      r.db.tables.manager_chat_state!.push({
        bot_id: "00000000-0000-4000-8000-0000000000aa",
        telegram_id: -1,
        active: true,
      });
    },
    steps: [
      {
        say: { button: "ORDERS", title: "📋 Мои заказы" },
        expect: { says: ["274"] },
      },
    ],
  },
  {
    id: "pay-card-remembered-for-consultant-ig-ru",
    title:
      "«Купить» → карточка оплаты: её текст запоминается для консультанта (вопрос «Выставите счёт / Халык» он решает по ней)",
    origin:
      "Копилка Русоведа, WhatsApp 28.10 16:24, заказ #274 (Djami): «Выставите счет на этот номер», «Халык» → консультант «уточните у менеджера», хотя «🧾 Перевод Kaspi» был в карточке над вопросом",
    channel: "instagram",
    locale: "ru",
    full: true,
    modules: { helpdesk: true, manager_chat: true },
    products: [{ id: P1, name: "Папка классного руководителя", price: 3500 }],
    steps: [
      {
        say: { button: `PROD:${P1}`, title: "Купить" },
        expect: {
          count: 1,
          says: ["К оплате: 3500 ₸"],
          state: {
            mode: "awaiting_proof",
            direct: {
              pay_card: {
                order: expect.any(Number),
                text: expect.stringContaining("К оплате: 3500 ₸"),
              },
            },
          },
        },
      },
    ],
  },
];
