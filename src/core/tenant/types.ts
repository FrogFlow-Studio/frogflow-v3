import type { ModuleKey } from "@/core/modules/registry";
import type { VerticalKey } from "@/core/verticals/registry";
import type { Locale } from "@/core/i18n/locale";
import type { ConsultantLimitsSetting } from "@/core/consultant/budget";
import type { SmartSearchLimitsSetting } from "@/core/search/smart-pure";

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
  /** Часовой пояс магазина (IANA); нет — APP_TIMEZONE платформы. */
  timezone?: string;
  telegram?: {
    /** @username бота — для ссылок и диагностики; токен лежит в bots.bot_token. */
    username?: string;
    /** Вебхук поставлен на этот деплой (ensure-webhook сверяет). */
    webhook_ok?: boolean;
  };
  zernio?: {
    /** Профиль Zernio клиента; аккаунты Instagram/WhatsApp внутри него. */
    profile_id?: string;
    /** Идентификаторы аккаунтов Zernio → этот арендатор. */
    account_ids?: string[];
    /** Снимок подключённых аккаунтов для панелей (обновляется синхронизацией). */
    accounts?: ZernioAccountSnapshot[];
    synced_at?: string;
  };
  /**
   * Модуль «Несколько ботов»: магазины с одинаковым `group` — один продавец,
   * его владелец переключается между ними в админке без второго входа.
   * Группу ставит только оператор (core/tenant/shop-group).
   */
  multi_bot?: { group?: string };
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
  };
  /** Переключатель миграции: пока v1 обслуживает клиента, v2 отвечает 409 на его вебхуки. */
  served_by?: "v1" | "v2";
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
  /** Свой дневной предел умного поиска в долларах (core/search). Меняет оператор. */
  smart_search_limits?: SmartSearchLimitsSetting | null;
  /** Поведение при неоплате подписки (те же ключи, что в v1; читает core/billing/subscription). */
  on_overdue?: "warn" | "suspend";
  warn_days_before?: number;
  grace_days?: number;
  /** Тариф (core/plans): ключ плана, надбавки, льготы, лимиты. */
  billing?: BillingSettings;
  /** Выдача цифровых товаров (core/delivery). */
  delivery?: {
    /** Водяной знак с покупателем и номером заказа на каждом выдаваемом PDF. */
    pdf_watermark?: boolean;
  };
};

export type BillingSettings = {
  /** Ключ плана (`flowers.pro`) или `custom`; в `bots.subscription_plan` — только уровень. */
  plan?: string;
  /** Каналы, докупленные сверх плана (core/plans/registry ADDONS). */
  addons?: Array<"whatsapp" | "instagram">;
  /** Модули, купленные по старой схеме или подаренные оператором: включены бесплатно сверх плана. */
  grandfathered?: ModuleKey[];
  /** Индивидуальные месячные лимиты вместо лимитов плана; null — без лимита. */
  ai_quota?: { ai_dialogs?: number | null; receipt_checks?: number | null };
  /** Оплата раз в месяц или раз в год (10 месяцев за 12). */
  period?: "month" | "year";
  /** Подключение оплачено (или не берётся — действующий клиент). */
  connection_paid_at?: string;
  /** Счёт, в который включено подключение: его подтверждение ставит connection_paid_at. */
  connection_invoice_id?: string;
  /** Версия состава планов, по которой клиент подключён. */
  plan_version?: number;
  /** Пробный период: до какой даты и был ли он уже. */
  trial_until?: string;
};

export type AdminUser = {
  username: string;
  password_hash: string;
  /** manager | viewer | accountant (core/auth/roles, STAFF_ROLES). */
  role: "manager" | "viewer" | "accountant";
  name?: string;
  created_at?: string;
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
