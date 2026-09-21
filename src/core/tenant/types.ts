import type { ModuleKey } from "@/core/modules/registry";
import type { VerticalKey } from "@/core/verticals/registry";
import type { Locale } from "@/core/i18n/locale";

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
  /** VIP-бот (модуль vip): второй токен тем же шифрованием, что bots.bot_token. */
  vip?: {
    token_enc?: string;
    username?: string;
    webhook_ok?: boolean;
  };
  /** Вход в админку клиента. */
  admin?: {
    username?: string;
    /** scrypt-хеш, см. core/auth/password.ts */
    password_hash?: string;
  };
  /** Переключатель миграции: пока v1 обслуживает клиента, v2 отвечает 409 на его вебхуки. */
  served_by?: "v1" | "v2";
  /** Поведение при неоплате подписки (те же ключи, что в v1; читает core/billing/subscription). */
  on_overdue?: "warn" | "suspend";
  warn_days_before?: number;
  grace_days?: number;
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
};

/** По какому признаку арендатор найден — для журнала и ответов 404. */
export type TenantLookup =
  | { by: "id"; value: string }
  | { by: "host"; value: string }
  | { by: "slug"; value: string }
  | { by: "zernio_account"; value: string };
