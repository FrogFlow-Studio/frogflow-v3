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

/** «Обычно отвечаем за N рабочих часов» — по фактам платформы; null, пока данных мало. */
export const supportTypicalFn = createServerFn({ method: "GET" }).handler(async () => {
  await (await guards()).requireAdmin();
  const { typicalResponseHours } = await import("@/app/operator/support.server");
  return typicalResponseHours();
});

export const sendSupportMessageFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        body: z.string().max(10_000),
        /** Скриншот, уже загруженный в Storage (/api/admin/upload, вид chatPhoto). */
        attachmentKey: z.string().max(300).nullable().optional(),
        /** Страница админки, с которой нажали «Поддержка»; если это заказ, в контекст идёт его номер. */
        page: z.string().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const g = await guards();
    const ctx = await g.requireAdminRole("manager");
    const { sendSellerMessage } = await import("@/core/support/support");
    const who = (await g.adminActor()).replace(/^admin:/, "");
    // Файл сверяется с правилами по тому, что лежит в бакете, а не по словам браузера.
    if (data.attachmentKey) {
      const { checkChatAttachment } = await import("./chat-attachment.server");
      await checkChatAttachment(ctx, {
        kind: "photo",
        key: data.attachmentKey,
        name: "screenshot",
      });
    }
    const orderId = /^\/admin\/orders\/(\d{1,12})(?:[?#].*)?$/.exec(data.page ?? "")?.[1];
    const orderNo = orderId ? await orderNumber(ctx, Number(orderId)) : null;
    const r = await sendSellerMessage(ctx, {
      body: data.body,
      authorName: who,
      attachmentKey: data.attachmentKey ?? null,
      context: { page: data.page, orderNo },
    });
    // Оператору — в Telegram, один раз на сообщение. Сбой оповещения не отменяет отправку.
    const { notifyOperator } = await import("./support-notify.server");
    await notifyOperator(
      ctx.tenant.id,
      ctx.tenant.name,
      r.message.id,
      r.message.body || "📎 скриншот",
    ).catch((e: unknown) => console.error("[support] оповещение оператора", e));
    return { message: r.message };
  });

/** Номер заказа магазина для контекста; не нашли или база не ответила — без номера (контекст не критичен). */
async function orderNumber(
  ctx: import("@/core/tenant/resolve.server").TenantContext,
  orderId: number,
): Promise<number | null> {
  const { data, error } = await ctx.db
    .from("orders")
    .select("order_no, display_no")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.error(`[support:${ctx.tenant.id}] номер заказа для контекста`, error.message);
    return null;
  }
  return data ? Number(data.display_no ?? data.order_no) : null;
}

/** Открыли чат — ответы оператора считаются прочитанными. */
export const supportReadFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await (await guards()).requireAdmin();
  const { markSellerRead } = await import("@/core/support/support");
  await markSellerRead(ctx);
  return { ok: true };
});
