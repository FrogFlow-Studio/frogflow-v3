import { pageAll } from "@/core/db/page";
/**
 * Таймлайн заказа — доказательство того, что произошло: создан, чек,
 * выдача каждой позиции, что не выдалось и почему. Своей таблицы у
 * журнала нет (схема заморожена до фазы 7), поэтому строки живут в
 * `zernio_logs` — единственном журнале арендатора со свободным типом и
 * jsonb-полезной нагрузкой: `event_type = order.<kind>`, `status = event`
 * (ретеншн держит такие строки 180 дней, как незавершённые), в `payload`
 * — `order_id` и детали.
 */
import type { Json } from "@/core/db-types";
import { scrubForLog } from "@/lib/log-mask";
import type { TenantContext } from "@/core/tenant/resolve.server";

export type OrderEventKind =
  | "placed"
  | "proof"
  | "delivery_started"
  | "item_sent"
  | "item_failed"
  | "item_pending"
  | "delivered"
  | "gift_rest"
  | "delivery_failed"
  | "rejected"
  | "reminded"
  | "status"
  | "notify_failed"
  | "email_sent"
  | "email_failed"
  /** Покупатель попросил письмо ещё раз (ИИ после оплаты, core/postpay): одно на 10 минут. */
  | "email_resend"
  /** Покупатель поблагодарил после выдачи, бот ответил (ИИ после оплаты): один раз на заказ. */
  | "thanked"
  | "payment"
  /** Шлюз прислал деньги по закрытому заказу: в оплату не записаны, решает продавец. */
  | "payment_on_closed"
  /** Сумма или валюта платежа не совпали с заказом: заказ не подтверждён. */
  | "payment_mismatch"
  | "fulfillment_changed"
  | "balance_proof"
  | "balance_paid"
  | "balance_overpaid"
  | "balance_closed"
  | "balance_credited"
  | "balance_link"
  | "balance_proof_rejected"
  | "refund"
  /** Возврат курса: покупателя исключили из закрытого канала / Telegram не исключил. */
  | "channel_revoked"
  | "channel_revoke_failed"
  /** Продавец продлил ученику доступ к курсу (с причиной). */
  | "access_extended"
  /** Ученика курса перевели в другой поток. */
  | "cohort_moved"
  | "approval_sent"
  | "approval_ok"
  | "approval_changes"
  | "courier"
  /** Продавец отправил посылку и указал трек-номер (core/orders/tracking). */
  | "tracking"
  | "subscription_renewal"
  /** Покупатель принял оферту и/или согласие на обработку данных при оформлении. */
  | "consent"
  /** Позиции взяты предзаказом (core/preorder): остаток не списан, срок отправки. */
  | "preorder"
  /** Продавец перенёс срок предзаказа: событие — «сообщаем покупателю» (один раз на перенос). */
  | "preorder_moved"
  /** Заказ — подарок: получатель и текст открытки (core/orders/gift), один раз на заказ. */
  | "gift";

export type OrderEvent = {
  id: string;
  at: string;
  kind: OrderEventKind;
  actor: string;
  payload: Record<string, Json | undefined>;
};

export const ORDER_EVENT_STATUS = "event";

/** События, после которых заказ считается проданным: оплата и начало выдачи. */
const SNAPSHOT_KINDS: ReadonlySet<OrderEventKind> = new Set(["payment", "delivery_started"]);

/** События с деньгами: потерянную запись повторяем и о постоянном сбое сообщаем в журнал ошибок. */
const MONEY_KINDS: ReadonlySet<OrderEventKind> = new Set([
  "payment",
  "payment_on_closed",
  "payment_mismatch",
  "refund",
]);

/**
 * Запись события; сбой журнала не должен ломать сам заказ. Событие с деньгами
 * («оплата», «возврат») при сбое пишется ещё раз с тем же `event_id` (дубль
 * после «потерянного ответа» не плодится: повтор отбивается уникальностью), и
 * если не вышло и со второго раза — это ошибка в журнале ошибок, а не строка
 * в консоли: оплата в заказе есть, а в истории и выгрузке «Оплаты» её нет.
 */
export async function recordOrderEvent(
  ctx: TenantContext,
  orderId: number,
  kind: OrderEventKind,
  payload: Record<string, Json | undefined> = {},
  actor = "bot",
): Promise<void> {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const row = {
    bot_id: ctx.tenant.id,
    event_id: `order:${orderId}:${kind}:${stamp}`,
    event_type: `order.${kind}`,
    status: ORDER_EVENT_STATUS,
    payload: scrubForLog({ order_id: orderId, actor, ...payload }) as Json,
  };
  let { error } = await ctx.db.from("zernio_logs").insert(row);
  if (error && MONEY_KINDS.has(kind)) {
    ({ error } = await ctx.db.from("zernio_logs").insert(row));
    // Первая запись могла дойти, потеряв ответ: повтор упёрся в уникальный event_id.
    if (error && /duplicate|unique/i.test(error.message)) error = null;
  }
  if (error) {
    console.warn(`[orders] событие ${kind} для #${orderId} не записано: ${error.message}`);
    if (MONEY_KINDS.has(kind)) {
      const { reportError } = await import("@/lib/errors");
      const { serverFailure } = await import("@/lib/server-failure");
      await reportError(
        serverFailure(`Событие ${kind} по заказу #${orderId} не записано: ${error.message}`),
        { where: "orders.recordOrderEvent", botId: ctx.tenant.id },
      ).catch(() => {});
    }
  }
  // Модуль profit: по заказу впервые прошли деньги или выдача — фиксируем себестоимость позиций.
  if (ctx.tenant.modules.profit && SNAPSHOT_KINDS.has(kind)) {
    const { snapshotOrderCost } = await import("@/core/profit/snapshot");
    await snapshotOrderCost(ctx, orderId);
  }
  // Модуль crm_integration: событие — во внешнюю CRM или таблицу продавца.
  if (ctx.tenant.modules.crm_integration) {
    const { queueCrmEvent } = await import("@/core/crm/webhook");
    await queueCrmEvent(ctx, kind, orderId, payload).catch((e) =>
      console.warn(`[crm] событие ${kind} для #${orderId}: ${String(e)}`),
    );
  }
}

/**
 * Событие, которое у заказа бывает один раз (например, письмо-напоминание):
 * event_id без случайной части, уникальность event_id отбивает повтор, даже
 * если два запуска крона пришли одновременно. true — событие записано этим
 * вызовом; false — оно уже было или запись не удалась (тогда действие не
 * делаем: лучше без письма, чем с двумя).
 */
export async function claimOrderEvent(
  ctx: TenantContext,
  orderId: number,
  kind: OrderEventKind,
  key: string,
  payload: Record<string, Json | undefined> = {},
  actor = "bot",
): Promise<boolean> {
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: `order:${orderId}:${kind}:${key}`,
    event_type: `order.${kind}`,
    status: ORDER_EVENT_STATUS,
    payload: scrubForLog({ order_id: orderId, actor, ...payload }) as Json,
  });
  if (error && error.code !== "23505")
    console.warn(`[orders] событие ${kind} для #${orderId} не записано: ${error.message}`);
  return !error;
}

export async function listOrderEvents(ctx: TenantContext, orderId: number): Promise<OrderEvent[]> {
  // Постранично, а сортировка кончается id: длинная история не обрезается, а
  // события одной секунды не меняются местами между страницами.
  const data = await pageAll<{
    id: string;
    created_at: string;
    event_type: string;
    payload: Json | null;
  }>(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, created_at, event_type, payload")
        .eq("status", ORDER_EVENT_STATUS)
        .like("event_type", "order.%")
        .eq("payload->>order_id", String(orderId))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    "Заказы: события",
  );
  return data.map((r) => {
    const p =
      r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
        ? (r.payload as Record<string, Json | undefined>)
        : {};
    return {
      id: r.id,
      at: r.created_at,
      kind: r.event_type.slice("order.".length) as OrderEventKind,
      actor: typeof p.actor === "string" ? p.actor : "bot",
      payload: p,
    };
  });
}

const str = (v: Json | undefined) => (typeof v === "string" ? v : "");
const num = (v: Json | undefined) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** Текст события для карточки заказа. */
export function describeOrderEvent(e: Pick<OrderEvent, "kind" | "actor" | "payload">): {
  text: string;
  tone: "neutral" | "ok" | "warn" | "danger";
} {
  const p = e.payload;
  const who = e.actor.startsWith("admin")
    ? ` (${e.actor.slice("admin:".length) || "продавец"})`
    : e.actor === "system"
      ? " (система)"
      : "";
  switch (e.kind) {
    case "placed":
      return p.platform === "manual"
        ? { text: `Заказ заведён вручную${who}`, tone: "neutral" }
        : { text: `Заказ создан${p.platform ? ` · ${str(p.platform)}` : ""}`, tone: "neutral" };
    case "payment":
      return {
        text: `Внесено ${num(p.amount)}${p.currency ? ` ${str(p.currency)}` : ""}${p.source === "deposit" ? " (задаток по чеку)" : p.source === "online" ? ` через ${str(p.provider)}` : p.source === "receipt" ? ` по чеку${num(p.overpaid) > 0 ? `, переплата ${num(p.overpaid)}` : ""}` : ""}${who}`,
        tone: "ok",
      };
    case "payment_on_closed":
      return {
        text: `Оплата ${num(p.amount)}${p.currency ? ` ${str(p.currency)}` : ""} через ${str(p.provider)}${p.invId ? ` (платёж ${str(p.invId)})` : ""} пришла по закрытому заказу — выполните заказ или верните деньги`,
        tone: "danger",
      };
    case "payment_mismatch":
      return {
        text: `Платёж ${num(p.amount)}${p.currency ? ` ${str(p.currency)}` : ""} через ${str(p.provider)}${p.invId ? ` (${str(p.invId)})` : ""} не совпал с заказом по сумме или валюте — заказ не подтверждён`,
        tone: "danger",
      };
    case "fulfillment_changed":
      return { text: `Получение изменено${who}`, tone: "neutral" };
    case "balance_proof":
      return {
        text: `Чек на остаток ${num(p.amount)} — проверьте и внесите оплату`,
        tone: "warn",
      };
    case "balance_proof_rejected":
      return { text: `Чек на остаток не принят${who}`, tone: "warn" };
    case "balance_paid":
      return {
        text: `Получен платёж за остаток ${num(p.amount)}${p.currency ? ` ${str(p.currency)}` : ""} через ${str(p.provider)}${p.invId ? `, счёт №${str(p.invId)}` : ""}`,
        tone: "neutral",
      };
    case "balance_credited":
      return {
        text: `Остаток ${num(p.amount)}${p.currency ? ` ${str(p.currency)}` : ""} внесён в оплату заказа${p.invId ? ` (счёт №${str(p.invId)})` : ""}`,
        tone: "ok",
      };
    case "balance_link":
      return {
        text: `Покупателю выдана ссылка на оплату остатка ${num(p.amount)}`,
        tone: "neutral",
      };
    case "balance_closed":
      return {
        text: `Оплата ${num(p.amount)} через ${str(p.provider)}${p.invId ? ` (счёт №${str(p.invId)})` : ""} пришла по закрытому заказу — выполните заказ или верните деньги`,
        tone: "danger",
      };
    case "balance_overpaid":
      return {
        text: `Оплата ${num(p.amount)} через ${str(p.provider)}${p.invId ? ` (счёт №${str(p.invId)})` : ""} не записана: остаток уже внесён — верните разницу покупателю`,
        tone: "danger",
      };
    case "proof":
      return p.text
        ? { text: `Чек получен текстом: «${str(p.text)}»`, tone: "neutral" }
        : { text: "Чек получен", tone: "neutral" };
    case "delivery_started":
      return { text: `Выдача начата${who}`, tone: "neutral" };
    case "item_sent":
      return {
        text: `Выдано: ${str(p.name)}${p.lang ? ` (${str(p.lang)})` : ""}`,
        tone: "ok",
      };
    case "item_failed":
      return {
        text: `Не выдалось: ${str(p.name)}${p.reason ? ` — ${str(p.reason)}` : ""}`,
        tone: "danger",
      };
    case "item_pending":
      return { text: `Покупателю задан вопрос о языке: ${str(p.name)}`, tone: "warn" };
    case "gift_rest":
      return p.failed
        ? {
            text: `Остаток сертификата ${num(p.amount)} ${str(p.currency)} не выдан — выдайте покупателю новый сертификат вручную`,
            tone: "danger",
          }
        : {
            text: `Остаток сертификата ${num(p.amount)} ${str(p.currency)} — новый код ${str(p.code)}`,
            tone: "neutral",
          };
    case "delivered":
      return { text: `Заказ выдан полностью (${num(p.sent)} поз.)`, tone: "ok" };
    case "delivery_failed":
      return {
        text: `Выдача не завершена: не удалось ${num(p.failed)} из ${num(p.total)}`,
        tone: "danger",
      };
    case "rejected":
      return { text: `Заказ отклонён${who}`, tone: "danger" };
    case "approval_sent":
      return { text: `Фото отправлено покупателю на согласование${who}`, tone: "neutral" };
    case "approval_ok":
      return { text: "Покупатель одобрил фото", tone: "ok" };
    case "approval_changes":
      return { text: `Покупатель просит правки: ${str(p.text)}`, tone: "warn" };
    case "subscription_renewal":
      return { text: "Покупателю напомнили продлить подписку", tone: "neutral" };
    case "consent":
      return {
        text: `Покупатель принял ${[p.offer ? "оферту" : "", p.privacy ? "согласие на обработку персональных данных" : ""].filter(Boolean).join(" и ")}`,
        tone: "neutral",
      };
    case "tracking":
      return {
        text: `Отправлено, трек: ${str(p.number) || str(p.url)}${who}`,
        tone: "neutral",
      };
    case "courier": {
      const names: Record<string, string> = {
        yandex: "Яндекс Доставка",
        indrive: "inDrive",
        own: "свой курьер",
        other: "курьерская служба",
      };
      return {
        text: `Передан курьеру: ${names[str(p.provider)] ?? str(p.provider)}${p.trackUrl ? " · ссылка отслеживания" : ""}${who}`,
        tone: "neutral",
      };
    }
    case "refund": {
      const extra = [
        p.reason ? `: ${str(p.reason)}` : "",
        p.pointsReturned ? ` · баллы ${num(p.pointsReturned)} возвращены` : "",
        p.pointsRevoked ? ` · начисленные ${num(p.pointsRevoked)} сняты` : "",
        p.promoReturned || p.giftReturned ? " · коды возвращены" : "",
        p.restocked ? " · товар на склад" : "",
      ].join("");
      return {
        text: `${p.full ? "Возврат" : "Частичный возврат"} ${num(p.amount)}${p.currency ? ` ${str(p.currency)}` : ""}${who}${extra}`,
        tone: "warn",
      };
    }
    case "channel_revoked":
      return {
        text: `Покупатель исключён из закрытого канала курса (${num(p.kicked)})${who}`,
        tone: "ok",
      };
    case "access_extended":
      return {
        text: `Доступ к курсу продлён до ${str(p.until)}${who} — причина: ${str(p.reason)}`,
        tone: "ok",
      };
    case "cohort_moved":
      return {
        text: `Ученик переведён в другой поток: «${str(p.from) || "—"}» → «${str(p.to)}»${who}${num(p.failed) > 0 ? " — не удалось исключить его из чата прежнего потока, удалите вручную" : ""}${p.stuck ? " — ссылка в чат нового потока не подготовлена, обратитесь к администратору платформы" : ""}`,
        tone: num(p.failed) > 0 || p.stuck ? "danger" : "ok",
      };
    case "channel_revoke_failed":
      return {
        text: "Не удалось исключить покупателя из закрытого канала курса — удалите его из канала вручную",
        tone: "danger",
      };
    case "gift":
      return {
        text: `🎁 Подарок${p.recipient ? ` для ${str(p.recipient)}` : ""}${p.message ? `: «${str(p.message)}»` : ""}${num(p.wrap) > 0 ? `, подарочная упаковка +${num(p.wrap)}` : ""}${p.truncated === true ? " (текст обрезан до лимита)" : ""}`,
        tone: "neutral",
      };
    case "preorder_moved":
      return {
        text: `Срок предзаказа «${str(p.name)}» перенесён: ${p.from ? str(p.from) : "без даты"} → ${p.to ? str(p.to) : "без даты"}${who}`,
        tone: "neutral",
      };
    case "preorder": {
      const lines = Array.isArray(p.lines)
        ? (p.lines as Array<{ quantity?: unknown; from?: unknown }>)
        : [];
      const dates = [
        ...new Set(lines.map((l) => (typeof l.from === "string" ? l.from : ""))),
      ].filter(Boolean);
      return {
        text: `Предзаказ: ${lines.length} поз., остаток не списан${dates.length ? `, отправка с ${dates.join(", ")}` : ", срок отправки не назван"}`,
        tone: "warn",
      };
    }
    case "reminded":
      return p.channel === "email"
        ? { text: `Напоминание об оплате — письмом на ${str(p.to)}`, tone: "neutral" }
        : { text: `Напоминание об оплате отправлено${who}`, tone: "neutral" };
    case "status":
      return { text: `Статус: ${str(p.to)}${who}`, tone: "neutral" };
    case "email_sent":
      if (p.kind === "notice")
        return { text: `Уведомление отправлено на почту ${str(p.to)}`, tone: "ok" };
      return {
        text: `Материалы отправлены на почту ${str(p.to)} (${num(p.files)} ссылок)`,
        tone: "ok",
      };
    case "email_failed":
      return { text: `Письмо на ${str(p.to)} не ушло: ${str(p.error)}`, tone: "warn" };
    case "email_resend":
      return {
        text: `Покупатель попросил материалы на почту ${str(p.to)} — бот отправил ещё раз`,
        tone: "neutral",
      };
    case "thanked":
      return {
        text: "Покупатель поблагодарил — бот ответил, обращение не открывалось",
        tone: "neutral",
      };
    case "notify_failed":
      return p.retrying
        ? { text: `Сообщение покупателю не ушло, повторим: ${str(p.text)}`, tone: "warn" }
        : { text: `Сообщение покупателю не доставлено: ${str(p.text)}`, tone: "warn" };
    default:
      return { text: String(e.kind), tone: "neutral" };
  }
}
