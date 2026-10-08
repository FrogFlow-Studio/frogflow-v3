import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: сообщения и рассылки владельцам, заявки на модули.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

const impl = () => import("./operator.server");

const botId = z.string().uuid();

export const notifyOwnerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        text: z.string().min(1).max(4000),
        template: z.enum(["payment", "checkin", "feature"]).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).notifyOwner(data.botId, data.text, data.template ?? null);
  });

export const ownerMessageDraftFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).ownerMessageDraft(data.botId);
  });

export const ownerMessagesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).listOwnerMessages(data.botId);
  });

/* ── заявки на модули ─────────────────────────────────────────────── */

export const moduleRequestsFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).listModuleRequests();
});

export const pendingRequestCountFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).pendingModuleRequestCount();
});

export const resolveModuleRequestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), action: z.enum(["enable", "dismiss"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).resolveModuleRequest(data.id, data.action);
  });

/* ── рассылка владельцам ──────────────────────────────────────────── */

export const ownerBroadcastsFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).listOwnerBroadcasts();
});

export const broadcastToOwnersFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ botIds: z.array(botId).min(1).max(500), text: z.string().trim().min(1).max(4000) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).broadcastToOwners(data.botIds, data.text);
  });
