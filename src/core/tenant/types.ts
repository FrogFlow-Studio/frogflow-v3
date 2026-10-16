import type { ModuleKey } from "@/core/modules/registry";
import type { VerticalKey } from "@/core/verticals/registry";
import type { Locale } from "@/core/i18n/locale";
import type { BotTextChannel, BotTextKey } from "@/core/bot-texts/registry";
import type { ConsultantLimitsSetting } from "@/core/consultant/budget";
import type { SmartSearchLimitsSetting } from "@/core/search/smart-pure";
import type { WizardMap } from "./wizard-entry";
import type { Collection } from "@/core/storefront/collections";

export type BotStatus = "active" | "paused" | "suspended";

/**
 * Настройки клиента в `bots.settings` (jsonb). Схема базы не меняется —
 * всё, что v2 нужно знать о клиенте сверх колонок `bots`, лежит здесь.
 * Ключи, которых v1 не знает, v1 не мешают.
 */
export type TenantSettings = {
  /** Короткое имя в адресах общего домена: app.frogflow.kz/s/<slug>. */
  slug?: string;
  /** Свои домены клиента — резолвер сравнивает с заголовком Host. */
  hosts?: string[];
  /** Язык интерфейса бота по умолчанию. */
  default_locale?: Locale;
  /** Через сколько дней после выдачи просить оценку (core/reviews/ask), 1–30; нет — 3. */
  review_ask_days?: number;
  /** Часовой пояс магазина (IANA); нет — APP_TIMEZONE платформы. */
  timezone?: string;
  telegram?: {
    /** @username бота — для ссылок и диагностики; токен лежит в bots.bot_token. */
    username?: string;
    /** Вебхук поставлен на этот деплой (ensure-webhook сверяет). */
    webhook_ok?: boolean;
    /** Отпечаток поставленного меню команд (channels/telegram/commands). */
    commands_v?: string;
  };
  zernio?: {
    /** Профиль Zernio клиента; аккаунты Instagram/WhatsApp внутри него. */
    profile_id?: string;
    /** Идентификаторы аккаунтов Zernio → этот арендатор. */
    account_ids?: string[];
    /** Снимок подключённых аккаунтов для панелей (обновляется синхронизацией). */
    accounts?: ZernioAccountSnapshot[];
    synced_at?: string;
    /** Страж каналов (channels/zernio/guard): что сейчас не работает по каждому каналу. */
    guard?: Partial<Record<"instagram" | "whatsapp", ChannelGuardEntry>>;
    /** Отпечаток поставленных быстрых вопросов Instagram; "" — мы ничего не ставили. */
    ice_breakers_v?: string;
    /** Мастер подключения канала (channels/zernio/wizard): где продавец застрял. */
    wizard?: WizardMap;
  };
  /**
   * Модуль «Несколько ботов»: магазины с одинаковым `group` — один продавец,
   * его владелец переключается между ними в админке без второго входа.
   * Группу ставит только оператор (core/tenant/shop-group).
   */
  multi_bot?: { group?: string };
  /**
   * Организация продавца в ApiPay (оплата Kaspi, core/payments/apipay-partner):
   * заводит оператор партнёрским ключом платформы.
   */
  apipay?: { org_id?: string };
  /** VIP-бот (модуль vip): второй токен тем же шифрованием, что bots.bot_token. */
  vip?: {
    token_enc?: string;
    username?: string;
    webhook_ok?: boolean;
  };
  /** Вход в админку клиента: владелец — от оператора, остальные — от владельца (core/auth/roles). */
  admin?: {
    username?: string;
    /** scrypt-хеш, см. core/auth/password.ts */
    password_hash?: string;
    users?: AdminUser[];
    /** Приглашения в команду по ссылке: хранится только хеш секрета (core/auth/staff-invite). */
    invites?: AdminInvite[];
  };
  /**
   * Кураторы онлайн-школы (core/courses/curators): несколько проверяющих
   * домашние задания. `rotate` — ученики по кругу, `cohort` — куратор ведёт
   * свои потоки (остальные — по кругу).
   */
  curators?: { mode?: "rotate" | "cohort"; items?: CuratorSetting[] };
  /** Быстрые ответы куратора к домашним заданиям (core/courses/hw-replies). */
  homework_replies?: HomeworkReply[];
  /** Переключатель миграции: пока v1 обслуживает клиента, v2 отвечает 409 на его вебхуки. */
  served_by?: "v1" | "v2";
  /**
   * Когда оператор перевёл клиента с v1 на v2 (ISO). Ставит только
   * setServedBy при переключении; по ней «Обзор» отличает переехавшего
   * продавца (заказы старше этой даты) от нового.
   */
  served_by_since?: string;
  /**
   * Владелец попросил удалить магазин (app/admin/deletion.server): магазин на
   * паузе 30 дней, владелец может восстановить; потом крон ретеншна его
   * архивирует и удаляет файлы. prev_status — статус до запроса.
   */
  deletion?: { requested_at: string; by: string; prev_status: BotStatus };
  /**
   * Центр уведомлений (core/notifications): когда каждый вход админки в
   * последний раз отметил ленту прочитанной (ISO по логину `admin:<логин>`).
   * Пишется только через patchTenantSettings: ключи соседей не затираются.
   */
  notify_read?: Record<string, string>;
  /** Код агентства-партнёра, которое привело клиента (core/partners). */
  partner?: string;
  /**
   * Автор, который пригласил этого продавца по ссылке (core/invites): `by` —
   * магазин-пригласивший. `reward` ставит оператор, когда зачёл пригласившему
   * месяц: условная запись по `rev`, поэтому зачёт выдаётся один раз.
   */
  invite?: {
    by: string;
    at: string;
    reward?: { at: string; by: string; payment_id: string | null };
  };
  /** Откуда пришёл продавец, зарегистрировавшийся сам (core/signup/origin). */
  signup?: { source?: string; page?: "cakes" | "materials" | "courses" | "instagram" | "kaspi" };
  /**
   * Свой дневной предел ИИ-консультанта (core/consultant/budget). Нет или
   * null — общий предел платформы. Меняет оператор в карточке клиента.
   */
  consultant_limits?: ConsultantLimitsSetting | null;
  /**
   * Сколько часов консультант молчит, когда отвечает человек (core/consultant/pause):
   * 1, 3, 12, 24 или 0 — «пока продавец не вернёт диалог боту». Нет — 12.
   */
  consultant_pause_hours?: number;
  /**
   * Консультант ищет по каталогу инструментом, а в подсказке — только карта
   * ассортимента (core/consultant/catalog-tool.server). Для больших каталогов:
   * без флага в подсказку идут первые 120 товаров. Ставит оператор.
   */
  consultant_search?: boolean;
  /**
   * Консультант «по прайсу» (BOVI, core/consultant/pricelist): прайс 1С в
   * app_settings вместо товаров магазина, рубли по курсу банка, нерабочие
   * часы. Включает оператор.
   */
  consultant_pricelist?: {
    enabled?: boolean;
    /** Рабочие часы магазина по его поясу: с open до close (0–24). Меняют оператор и продавец. */
    hours?: { open: number; close: number };
    /** Откуда курс рубля: ВТБ, finkaz или вручную (core/consultant/pricelist/rate). */
    rate_source?: "vtb" | "finkaz" | "manual";
    /** Страница банка на finkaz.kz (по умолчанию Kaspi). */
    rate_url?: string;
    /**
     * Образ консультанта, который правит продавец (core/consultant/pricelist/
     * persona): название, о магазине, тон, особенности товаров. Нет — текст BOVI.
     */
    persona?: {
      brand: string;
      about: string;
      tone: string;
      specialities: string;
    };
    /**
     * «Виртуальный консультант» (галочка продавца): в первом сообщении бот
     * говорит, что он виртуальный консультант, и что живой ответит в рабочие
     * часы (`hours`), если написать «консультант» (pricelist/prompt).
     */
    virtual_intro?: boolean;
  };
  /**
   * Свои тексты бота (core/bot-texts): ключ текста → канал → язык → текст
   * продавца. null/нет — стандартный текст. Меняется страницей «Тексты бота».
   */
  bot_texts?: Partial<
    Record<BotTextKey, Partial<Record<BotTextChannel, Partial<Record<Locale, string>>>> | null>
  >;
  /** Рабочие часы по поясу магазина (0–24): вне них бот шлёт текст «вне часов работы». Нет — не шлёт. */
  work_hours?: { open: number; close: number } | null;
  /** Свой дневной предел умного поиска в долларах (core/search). Меняет оператор. */
  smart_search_limits?: SmartSearchLimitsSetting | null;
  /** Поведение при неоплате подписки (те же ключи, что в v1; читает core/billing/subscription). */
  on_overdue?: "warn" | "suspend";
  warn_days_before?: number;
  grace_days?: number;
  /** Тариф (core/plans): ключ плана, надбавки, льготы, лимиты. */
  billing?: BillingSettings;
  /**
   * Комиссия платформы (core/commission): дата начала у клиента, `YYYY-MM-DD`
   * по поясу магазина; нет — `COMMISSION_DEFAULT_START`. Ставит оператор.
   * `billed` — месяцы `ГГГГ-ММ`, за которые комиссия уже вошла в счёт за подписку
   * (значение — номер счёта); отметку ставит выставление счёта, не оператор.
   * `amounts` — сколько комиссии за месяц уже выставлено, ₸ (целые); по нему поздно
   * оплаченные заказы доплачиваются следующим счётом. `topup` — последняя доплата
   * за месяц: номер счёта и сумма до неё (`prev`), чтобы отмена счёта вернула её.
   */
  commission?: {
    start?: string;
    billed?: Record<string, string>;
    amounts?: Record<string, number>;
    topup?: Record<string, { invoice: string; prev: number }>;
  };
  /**
   * Продажа подарочных сертификатов на витрине сайта (core/discounts/gift-sale):
   * включает продавец, номиналы — до шести, валюта — одна на все номиналы.
   */
  gift_sale?: { enabled?: boolean; amounts?: number[]; currency?: string };
  /**
   * Профиль автора в сообществе (core/community/profile). По умолчанию выключен:
   * автор сам включает «Показывать меня в сообществе».
   */
  community?: {
    enabled?: boolean;
    name?: string;
    niche?: string;
    city?: string;
    about?: string;
    links?: string[];
    /** Не принимать личные сообщения от авторов (С3). */
    dm_off?: boolean;
    /** Авторы (bot_id), которым адресат запретил писать ему лично (С3). */
    dm_blocked?: string[];
  };
  /** Магазины (bot_id), которые автор рекомендует; показываются только при взаимной рекомендации (С6). */
  community_recommend?: string[];
  /** Артикулы из импорта каталога: артикул (нижний регистр) → id товара. Схему базы не трогаем, ключ живёт здесь (Р1). */
  catalog_skus?: Record<string, string>;
  /** Решение оператора по сообществу: скрыт из списка авторов или заблокирован. */
  community_mod?: { status?: "hidden" | "blocked"; reason?: string; at?: string };
  /** Страница «О магазине» (core/storefront/about): описание, контакты, часы, доставка, оплата. */
  storefront_about?: {
    description?: string;
    phone?: string;
    address?: string;
    hours?: string;
    delivery?: string;
    payment?: string;
  };
  /** Оформление витрины (core/storefront/design): тема, обложка, порядок блоков главной, форма фото. */
  storefront_design?: { theme?: string; cover?: boolean; blocks?: string[]; photo?: string };
  /**
   * Площадка FrogFlow (core/marketplace): магазин участвует только по согласию.
   * `listed` — выключатель продавца, `hidden` — решение оператора (сильнее согласия),
   * `approved` — одобрение оператора для нового магазина (В12). `category` и `city`
   * — подписи в каталоге; нет категории — берётся ниша магазина.
   */
  marketplace?: {
    listed?: boolean;
    hidden?: boolean;
    hidden_reason?: string;
    approved?: boolean;
    category?: string;
    city?: string;
  };
  /** Подборки товаров витрины (core/storefront/collections). */
  collections?: Collection[];
  /** Выдача цифровых товаров (core/delivery). */
  delivery?: {
    /** Водяной знак с покупателем и номером заказа на каждом выдаваемом PDF. */
    pdf_watermark?: boolean;
  };
};

/** Ключи надбавок; те же, что ADDONS в core/plans/registry (тест сверяет). */
export const BILLING_ADDONS = ["whatsapp", "instagram", "vip", "ai_pack"] as const;
export type BillingAddon = (typeof BILLING_ADDONS)[number];

/** Периоды оплаты подписки; месяцы и цена — core/plans/registry PERIOD_MONTHS. */
export const BILLING_PERIODS = ["month", "quarter", "year"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export type BillingSettings = {
  /** Ключ плана (`flowers.pro`) или `custom`; в `bots.subscription_plan` — только уровень. */
  plan?: string;
  /** Надбавки сверх плана: каналы, VIP-клуб, пакет диалогов ИИ (core/plans/registry ADDONS). */
  addons?: BillingAddon[];
  /** Модули, купленные по старой схеме или подаренные оператором: включены бесплатно сверх плана. */
  grandfathered?: ModuleKey[];
  /** Индивидуальные месячные лимиты вместо лимитов плана; null — без лимита. */
  ai_quota?: { ai_dialogs?: number | null; receipt_checks?: number | null };
  /** Оплата раз в месяц, раз в 3 месяца или раз в год (10 месяцев за 12). */
  period?: BillingPeriod;
  /**
   * Цена плана в месяц по договору, ₸ (без надбавок каналов): вместо цены
   * тарифа в счетах, продлении и выручке. Нет — цена тарифа (MONTHLY_PRICE).
   */
  monthly_price?: number;
  /** Подключение оплачено (или не берётся — действующий клиент). */
  connection_paid_at?: string;
  /** Счёт, в который включено подключение: его подтверждение ставит connection_paid_at. */
  connection_invoice_id?: string;
  /** Версия состава планов, по которой клиент подключён. */
  plan_version?: number;
  /** Пробный период: до какой даты и был ли он уже. */
  trial_until?: string;
};

/** Быстрый ответ куратора: название на кнопке и текст комментария ({name} — имя ученика). */
export type HomeworkReply = { title: string; text: string };

export type CuratorSetting = {
  /** Стабильный id: к нему привязаны уже назначенные ученики. */
  id: string;
  name: string;
  /** Telegram, куда уходят работы на проверку. */
  telegram_id: number;
  /** Логин в админке: по нему работает фильтр «Мои». */
  username?: string;
  /** Потоки (id из core/courses/cohort), которые ведёт куратор. */
  cohorts?: string[];
};

/** Приглашение в команду: одноразовое, со сроком; секрет в ссылке, здесь его sha256. */
export type AdminInvite = {
  id: string;
  hash: string;
  role: "admin" | "manager" | "viewer" | "accountant";
  name?: string;
  created_at: string;
  expires_at: string;
  /** Логин владельца, создавшего приглашение. */
  by: string;
};

export type AdminUser = {
  username: string;
  password_hash: string;
  /** admin | manager | viewer | accountant (core/auth/roles, STAFF_ROLES). */
  role: "admin" | "manager" | "viewer" | "accountant";
  name?: string;
  created_at?: string;
};

/**
 * Запись стража канала: канал не работает с `since`. Причина: слетел токен,
 * отключён вебхук Zernio или серия сбоев отправки (`fails` из `last_fail_at`;
 * пока сбоев меньше порога, запись «на подозрении» и ничего не значит).
 */
export type ChannelGuardEntry = {
  since: string;
  reason: "token" | "webhook" | "failures";
  fails?: number;
  last_fail_at?: string;
};

export type ZernioAccountSnapshot = {
  id: string;
  platform: string;
  username?: string;
  name?: string;
  expired?: boolean;
};

export type Tenant = {
  id: string;
  name: string;
  status: BotStatus;
  vertical: VerticalKey;
  modules: Record<ModuleKey, boolean>;
  settings: TenantSettings;
  pausedMessage: string | null;
  ownerTelegramId: number | null;
  /** Публичный адрес клиента; у v1-клиентов — адрес их Vercel-деплоя. */
  appUrl: string | null;
  archived: boolean;
  /** Зашифрованный токен Telegram (enc:v1:…) или null, если бот в Telegram не подключён. */
  telegramTokenEnc: string | null;
  /** `settings.billing.plan`: ключ плана (`flowers.pro`), `custom` или null — модули вручную. */
  plan: string | null;
};

/** По какому признаку арендатор найден — для журнала и ответов 404. */
export type TenantLookup =
  | { by: "id"; value: string }
  | { by: "host"; value: string }
  | { by: "slug"; value: string }
  | { by: "zernio_account"; value: string };
