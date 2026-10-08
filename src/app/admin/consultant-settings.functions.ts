import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";

/**
 * Админка продавца: настройки ИИ-консультанта.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

/** Настройки магазина — владельцу и администратору; тариф, платежи, команда и удаление — только владельцу. */
const adminLevel = async () => (await import("@/app/auth/guards.server")).requireAdminRole("admin");

/* ── ИИ-консультант ──────────────────────────────────────────────── */

export const consultantFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { loadConsultant, consultantConfigured, KEYS } =
    await import("@/core/consultant/engine.server");
  const { getSettings } = await import("@/core/settings/settings");
  const { pricelistMode } = await import("@/core/consultant/pricelist/mode");
  const { KNOWLEDGE_KEY } = await import("@/core/consultant/pricelist/knowledge");
  const { CATALOG_META_KEY } = await import("@/core/consultant/pricelist/catalog.server");
  const [c, s] = await Promise.all([
    loadConsultant(ctx),
    getSettings(ctx, [KEYS.usage, KEYS.lastError, KNOWLEDGE_KEY, CATALOG_META_KEY]),
  ]);
  let usage = { count: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  try {
    usage = { ...usage, ...(JSON.parse(s[KEYS.usage] || "{}") as object) };
  } catch {
    /* пусто */
  }
  const { pauseHours } = await import("@/core/consultant/pause");
  return {
    ...c,
    configured: consultantConfigured(),
    usage,
    lastError: s[KEYS.lastError] ?? "",
    pauseHours: pauseHours(ctx.tenant),
    pricelist: {
      on: pricelistMode(ctx.tenant),
      articles: countArticles(s[KNOWLEDGE_KEY]),
      hasCatalog: Boolean(s[CATALOG_META_KEY]?.trim()),
    },
  };
});

/**
 * Статьи базы знаний консультанта по прайсу (`consultant_knowledge_json`, как у
 * v1): сколько их на самом деле, без статей по умолчанию.
 */
function countArticles(raw: string | null | undefined): number {
  try {
    const v = JSON.parse(raw ?? "") as unknown;
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

export const saveConsultantFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        profile: z.object({
          brand_name: z.string().min(1).max(120),
          goal: z.enum(["direct_sales", "book_call", "booking", "expert_faq"]),
          tone: z.enum(["friendly_expert", "formal", "luxury_warm", "casual"]),
          primary_language: z.enum(["ru", "kk", "en"]),
          countries: z.array(z.string().max(8)).max(10),
          currency: z.string().min(3).max(3),
          website_url: z.string().max(200).optional(),
          delivery_info: z.string().max(1000).optional(),
          payment_info: z.string().max(1000).optional(),
          about: z.string().max(1500).optional(),
          custom_instructions: z.string().max(3000).optional(),
          medical_disclaimer: z.boolean().optional(),
        }),
        docs: z
          .array(
            z.object({
              id: z.string().max(40),
              title: z.string().min(1).max(160),
              category: z.string().max(80).optional(),
              content: z.string().min(1).max(6000),
            }),
          )
          .max(60),
        pauseHours: z
          .union([
            z.literal(1),
            z.literal(3),
            z.literal(6),
            z.literal(12),
            z.literal(24),
            z.literal(0),
          ])
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    const { setSetting } = await import("@/core/settings/settings");
    const { KEYS } = await import("@/core/consultant/engine.server");
    await setSetting(ctx, KEYS.enabled, data.enabled ? "true" : "false");
    await setSetting(ctx, KEYS.profile, JSON.stringify(data.profile));
    await setSetting(ctx, KEYS.knowledge, JSON.stringify(data.docs));
    if (
      data.pauseHours !== undefined &&
      data.pauseHours !== ctx.tenant.settings.consultant_pause_hours
    ) {
      // В bots.settings: пауза читается из контекста арендатора на каждом сообщении без похода в app_settings.
      const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
      await patchTenantSettings(ctx.tenant.id, { consultant_pause_hours: data.pauseHours });
    }
    return { ok: true };
  });

/**
 * Проверка из админки: ответ на пробный вопрос без записи в базу. С историей
 * (`history`, `extra`) — пробный диалог из нескольких реплик: что уже
 * спросили и что консультант запомнил, живёт в браузере (core/consultant/test-chat).
 */
export const consultantTestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        text: z.string().trim().min(1).max(1000),
        history: z
          .array(
            z.object({
              role: z.enum(["customer", "assistant"]),
              text: z.string().max(2000),
            }),
          )
          .max(40)
          .optional(),
        /** Память пробного диалога — JSON-строкой, как её вернул прошлый ответ. */
        extra: z.string().max(20_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminLevel();
    const { runConsultant } = await import("@/core/consultant/engine.server");
    const { nextTestChat, parseTestExtra, testChatState } =
      await import("@/core/consultant/test-chat");
    const history = data.history ?? [];
    const extra = parseTestExtra(data.extra);
    const r = await runConsultant(ctx, null, data.text, {
      platform: "admin_test",
      dryRun: true,
      testState: testChatState(history, extra),
    });
    if (!r)
      throw new UserError("err.admin.noAnthropicKey", "На платформе не задан ключ Anthropic.");
    const { testState, ...rest } = r;
    const next = nextTestChat(history, data.text, r.reply, extra, testState);
    return { ...rest, history: next.history, extra: JSON.stringify(next.extra) };
  });
