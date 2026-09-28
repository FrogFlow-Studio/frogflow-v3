/**
 * Единственное место, где читается process.env.
 *
 * В v1 переменных было ~40 на деплой и часть из них (BOT_ID, VERTICAL,
 * TELEGRAM_BOT_TOKEN, ZERNIO_PROFILE_ID, ADMIN_PASSWORD…) описывала не
 * платформу, а конкретного клиента — поэтому на каждого клиента нужен был
 * свой деплой. В v2 окружение описывает только платформу: одна база, один
 * секрет подписи, один ключ шифрования. Всё, что про клиента, лежит в базе
 * (строка `bots`) и приходит в код через TenantContext.
 *
 * Правило ESLint `no-restricted-syntax` запрещает process.env везде, кроме
 * этой папки — чтобы «ещё одна переменная на клиента» не появилась снова.
 */
import { z } from "zod";

const schema = z.object({
  /** Публичный адрес деплоя без хвостового слэша: https://app.frogflow.kz */
  APP_URL: z
    .string()
    .url()
    .transform((s) => s.replace(/\/$/, "")),

  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /**
   * Legacy HS256 JWT secret проекта Supabase. Им v2 подписывает ключ
   * арендатора на каждый запрос (role: tenant_bot, bot_id) — тот же ключ,
   * который v1 выпускала скриптом mint-tenant-key.mjs один раз на деплой.
   */
  SUPABASE_JWT_SECRET: z.string().min(16),

  /**
   * Ключ шифрования секретов клиентов (токен Telegram, ключи Zernio) в базе.
   * 32 байта в base64 или hex. См. core/secrets/vault.ts.
   */
  SECRETS_KEY: z.string().min(32),

  /** Секрет подписи cookie сессий админки и панели оператора. */
  SESSION_SECRET: z.string().min(32),

  /** Подпись вебхуков Telegram выводится из него по bot_id (channels/telegram/secret.ts). */
  WEBHOOK_SECRET: z.string().min(32),

  /** Bearer для /api/cron/* — Vercel Cron присылает его сам. */
  CRON_SECRET: z.string().min(16),

  /** Панель оператора — владелец платформы. */
  // Запасной вход оператора, пока учётка не задана в базе (operator_settings).
  OPERATOR_USERNAME: z.string().min(1).optional(),
  OPERATOR_PASSWORD: z.string().min(8).optional(),

  /** Zernio: один аккаунт платформы, профили клиентов — в базе. */
  ZERNIO_API_KEY: z.string().optional(),
  ZERNIO_WEBHOOK_SECRET: z.string().optional(),
  ZERNIO_BASE_URL: z.string().url().optional(),

  TELEGRAM_API_BASE: z.string().url().default("https://api.telegram.org"),

  ANTHROPIC_API_KEY: z.string().optional(),
  /** Модель ИИ-консультанта; по умолчанию Haiku 4.5, как в v1 — счёт идёт клиенту. */
  CONSULTANT_MODEL: z.string().optional(),
  GOOGLE_VISION_API_KEY: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Курс ВТБ Казахстан для консультанта по прайсу: ВТБ рвёт соединения из-за
  // рубежа, нужен адрес внутри Казахстана, отдающий ответ ВТБ как есть.
  CONSULTANT_VTB_RELAY_URL: z.string().url().optional(),
  // Push-уведомления админки (core/push): ключи VAPID P-256 в base64url —
  // открытый (65 байт) и закрытый (32 байта); контакт для служб push.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  APP_TIMEZONE: z.string().default("Asia/Almaty"),

  /**
   * Самостоятельная регистрация продавцов на /signup: "1" — открыта. По
   * умолчанию закрыта: новый магазин получает ИИ-консультанта на ключе
   * платформы, а капчи нет — открывать сознательно (лимиты: signup.server).
   */
  SIGNUP_ENABLED: z.string().default("0"),

  /**
   * Учёт ошибок (src/lib/errors.ts): DSN проекта Sentry или GlitchTip.
   * Пусто — ошибки только в журнале функции.
   */
  SENTRY_DSN: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),

  VERCEL_ENV: z.string().optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  VERCEL_GIT_COMMIT_REF: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Читает и проверяет окружение один раз. Падает громко и с перечнем
 * недостающих переменных — деплой без секретов не должен стартовать и тихо
 * отвечать «что-то пошло не так».
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Окружение настроено неверно — ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

/** Только для тестов: подменить окружение. */
export function setEnvForTests(values: Partial<Env> | undefined): void {
  cached = values ? (schema.parse({ ...testDefaults, ...values }) as Env) : undefined;
}

const testDefaults: Record<string, string> = {
  APP_URL: "https://app.test",
  SUPABASE_URL: "https://xyz.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SUPABASE_JWT_SECRET: "test-jwt-secret-test-jwt-secret",
  SECRETS_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  SESSION_SECRET: "session-secret-session-secret-session-secret",
  WEBHOOK_SECRET: "webhook-secret-webhook-secret-webhook-secret",
  CRON_SECRET: "cron-secret-cron-secret",
  OPERATOR_USERNAME: "operator",
  OPERATOR_PASSWORD: "operator-password",
};
