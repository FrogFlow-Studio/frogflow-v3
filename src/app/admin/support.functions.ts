import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Чат с поддержкой платформы. Читает вся команда магазина (кроме бухгалтера),
 * писать может менеджер и владелец. Раздел выключен, пока в базе нет таблиц
 * (миграция 19-1): ответ несёт `available: false`.
 */
const guards = () => import("@/app/auth/guards.server");

export const supportFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await guards()).requireAdmin();
  const { loadSupport } = await import("@/core/support/support");
  return loadSupport(ctx);
});

export const sendSupportMessageFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ body: z.string().max(10_000) }).parse(d))
  .handler(async ({ data }) => {
    const g = await guards();
    const ctx = await g.requireAdminRole("manager");
    const { sendSellerMessage } = await import("@/core/support/support");
    const who = (await g.adminActor()).replace(/^admin:/, "");
    const r = await sendSellerMessage(ctx, { body: data.body, authorName: who });
    // Оператору — в Telegram, один раз на сообщение. Сбой оповещения не отменяет отправку.
    const { notifyOperator } = await import("./support-notify.server");
    await notifyOperator(ctx.tenant.id, ctx.tenant.name, r.message.id, r.message.body).catch(
      (e: unknown) => console.error("[support] оповещение оператора", e),
    );
    return { message: r.message };
  });

/** Открыли чат — ответы оператора считаются прочитанными. */
export const supportReadFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await (await guards()).requireAdmin();
  const { markSellerRead } = await import("@/core/support/support");
  await markSellerRead(ctx);
  return { ok: true };
});
