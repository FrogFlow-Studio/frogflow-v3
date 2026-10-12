import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: события, проверки переезда, кроны, здоровье платформы и оповещения о сбоях.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

const impl = () => import("./operator.server");

const botId = z.string().uuid();

export const allEventsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        botId: z.string().uuid().nullable().optional(),
        kind: z.string().max(40).nullable().optional(),
        who: z.enum(["shop", "platform"]).nullable().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).listAllEvents({
      botId: data.botId ?? null,
      kind: data.kind ?? null,
      who: data.who ?? null,
    });
  });

export const preflightAllFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).preflightAll();
});

export const setServedByBulkFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botIds: z.array(botId).min(1).max(50) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).setServedByBulk(data.botIds);
  });

export const cronStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { listCronStatus } = await import("./cron-status.server");
  return listCronStatus();
});

export const runBulkFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botIds: z.array(botId).min(1).max(1000),
        batchId: z.string().uuid(),
        confirmCount: z.string().max(10),
        action: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("message"), text: z.string().max(5000) }),
          z.object({ kind: z.literal("extend"), days: z.number().int() }),
          z.object({ kind: z.literal("module"), module: z.string().max(60) }),
        ]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { runBulk } = await import("./bulk.server");
    return runBulk({ ...data, actor: await actor() });
  });

export const platformHealthFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { platformHealth } = await import("./platform-health.server");
  return platformHealth();
});

/* ── уведомления оператору о сбоях ботов (health-alerts.server.ts) ── */

const alerts = () => import("./health-alerts.server");

export const alertChannelStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await alerts()).alertChannelStatus();
});

export const saveAlertChannelFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ token: z.string().max(200), chatId: z.string().max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await alerts()).saveAlertChannel(data);
    return { ok: true };
  });

export const clearAlertChannelFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  await (await alerts()).clearAlertChannel();
  return { ok: true };
});

export const testAlertChannelFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  return (await alerts()).testAlertChannel();
});

/** Вебхук v2 в Zernio: состояние (только чтение) и привязка к профилям клиентов на v2. */
export const v2WebhookStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await import("@/channels/zernio/connect.server")).v2WebhookStatus();
});

export const syncV2WebhookFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  return (await import("@/channels/zernio/connect.server")).syncV2Webhook();
});

export const healthHistoryFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({ botId: z.string().uuid(), days: z.number().int().min(1).max(60).optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("./health.server")).getHealthHistory(data.botId, data.days ?? 14);
  });

export const recordHealthNowFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./health.server")).recordHealthSnapshots(data.botId);
  });

/** Пробная ошибка в Sentry — проверить, что SENTRY_DSN рабочий. */
export const sendTestErrorFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  const { sendTestError } = await import("@/lib/errors");
  return sendTestError();
});

/* ── аудит чеков (только чтение, лимит клиента не тратится) ───────── */

export const receiptAuditInventoryFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./receipt-audit.server")).receiptAuditInventory(data.botId);
  });

/** Один шаг прогона: следующий чек с новых к старым; ИИ — с ключа платформы. */
export const receiptAuditScanFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        afterId: z.number().int().min(0),
        seenHashes: z
          .array(
            z.object({
              hash: z.string().max(128),
              orderId: z.number().int(),
              displayNo: z.union([z.number(), z.string().max(32)]),
            }),
          )
          .max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("./receipt-audit.server")).scanNextReceipt(data.botId, {
      afterId: data.afterId,
      seenHashes: data.seenHashes,
    });
  });
