import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: поддержка: чат клиентов с платформой.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

const botId = z.string().uuid();

/* ── поддержка: чат клиентов с платформой ─────────────────────────── */

const supportImpl = () => import("./support.server");

/** Входящие: незакрытые обращения всех клиентов; null — раздел выключен (нет таблиц). */
export const supportInboxFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        status: z.enum(["new", "in_progress", "waiting_seller", "resolved"]).optional(),
        label: z.string().trim().min(1).max(30).optional(),
      })
      .default({})
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await supportImpl()).supportInbox(data);
  });

/** Статус обращения вручную; смена пишется в журнал клиента. */
export const supportStatusFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        status: z.enum(["new", "in_progress", "waiting_seller", "resolved"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await supportImpl()).setThreadStatus(data.botId, data.status, await actor());
  });

export const supportLabelsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, labels: z.array(z.string().max(60)).max(20) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await supportImpl()).setThreadLabels(data.botId, data.labels, await actor());
  });

/** Заметка оператора к обращению: продавцу не видна (таблица закрыта от его роли). */
export const supportNoteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ botId, note: z.string().max(10_000), expectedAt: z.string().max(40).nullable() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await supportImpl()).saveThreadNote(
      data.botId,
      { note: data.note, expectedAt: data.expectedAt },
      await actor(),
    );
  });

export const supportConversationFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await supportImpl()).supportConversation(data.botId);
  });

export const supportReplyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, body: z.string().max(10_000) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const r = await (
      await supportImpl()
    ).operatorReply(data.botId, {
      body: data.body,
      operator: await actor(),
    });
    // Продавцу в Telegram — один раз на сообщение; не дошло — оператор увидит причину.
    const { notifySeller } = await import("@/app/admin/support-notify.server");
    const notice = await notifySeller(data.botId, r.message.id, r.message.body).catch(
      (e: unknown) => {
        console.error("[support] оповещение продавца", e);
        return "failed" as const;
      },
    );
    return { message: r.message, notice };
  });
