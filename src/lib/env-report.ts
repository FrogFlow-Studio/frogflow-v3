/**
 * Отчёт об окружении для /api/health: какие переменные заданы. Только имена и
 * «есть/нет», значения не попадают никуда. Список ведём вручную рядом со
 * схемой в config/env.ts; тест сверяет, что каждое имя из него есть в схеме.
 */

export type EnvVarSpec = {
  name: string;
  /** required — без неё платформа не стартует; feature — включает функцию. */
  kind: "required" | "feature";
  /** Что включает (для feature) или зачем нужна (для required). */
  note: string;
};

export const ENV_VARS: readonly EnvVarSpec[] = [
  { name: "APP_URL", kind: "required", note: "публичный адрес деплоя" },
  { name: "SUPABASE_URL", kind: "required", note: "база" },
  { name: "SUPABASE_PUBLISHABLE_KEY", kind: "required", note: "база" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", kind: "required", note: "база" },
  { name: "SUPABASE_JWT_SECRET", kind: "required", note: "роль арендатора" },
  { name: "SECRETS_KEY", kind: "required", note: "шифрование токенов" },
  { name: "SESSION_SECRET", kind: "required", note: "сессии панелей" },
  { name: "WEBHOOK_SECRET", kind: "required", note: "вебхуки Telegram" },
  { name: "CRON_SECRET", kind: "required", note: "кроны" },
  { name: "OPERATOR_USERNAME", kind: "feature", note: "запасной вход оператора" },
  { name: "OPERATOR_PASSWORD", kind: "feature", note: "запасной вход оператора" },
  { name: "ZERNIO_API_KEY", kind: "feature", note: "Instagram и WhatsApp" },
  { name: "ZERNIO_WEBHOOK_SECRET", kind: "feature", note: "вебхук Zernio" },
  { name: "APIPAY_API_KEY", kind: "feature", note: "оплата ApiPay" },
  { name: "APIPAY_WEBHOOK_SECRET", kind: "feature", note: "вебхук ApiPay" },
  { name: "ANTHROPIC_API_KEY", kind: "feature", note: "ИИ-консультант и лиды" },
  { name: "GOOGLE_VISION_API_KEY", kind: "feature", note: "распознавание чеков" },
  { name: "SMTP_HOST", kind: "feature", note: "почта" },
  { name: "SMTP_USER", kind: "feature", note: "почта" },
  { name: "SMTP_PASSWORD", kind: "feature", note: "почта" },
  { name: "SMTP_FROM", kind: "feature", note: "почта" },
  { name: "VAPID_PUBLIC_KEY", kind: "feature", note: "push админки" },
  { name: "VAPID_PRIVATE_KEY", kind: "feature", note: "push админки" },
  { name: "SENTRY_DSN", kind: "feature", note: "учёт ошибок" },
  { name: "YANDEX_VERIFICATION", kind: "feature", note: "подтверждение в Яндекс Вебмастере" },
  { name: "CONSULTANT_VTB_RELAY_URL", kind: "feature", note: "курс ВТБ для консультанта" },
];

export type EnvReportItem = EnvVarSpec & { set: boolean };

export type EnvReport = {
  /** false, если не задана хотя бы одна обязательная. */
  ok: boolean;
  /** Имена недостающих обязательных. */
  missingRequired: string[];
  vars: EnvReportItem[];
};

export function envReport(present: ReadonlySet<string>): EnvReport {
  const vars = ENV_VARS.map((v) => ({ ...v, set: present.has(v.name) }));
  const missingRequired = vars.filter((v) => v.kind === "required" && !v.set).map((v) => v.name);
  return { ok: missingRequired.length === 0, missingRequired, vars };
}
