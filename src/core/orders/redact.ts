/**
 * Заказ для бухгалтера: суммы, статусы, оплаты и позиции — да; кто покупатель
 * и как с ним связаться — нет. Режем на сервере, до ответа, а не в интерфейсе.
 * Заметки продавца и к доставке — тоже: туда пишут телефоны и адреса.
 */
export const CONTACT_FIELDS = [
  "customer_email",
  "contact",
  "display_name",
  "username",
  "user_key",
  "zernio_conversation_id",
  "fulfillment_address",
  "fulfillment_note",
  "admin_note",
] as const;

export function redactOrder<T extends object>(order: T): T {
  const o = { ...order } as Record<string, unknown>;
  for (const f of CONTACT_FIELDS) if (f in o) o[f] = null;
  // telegram_id — адрес чата покупателя; число оставляем, но пустое.
  if ("telegram_id" in o) o.telegram_id = 0;
  // Файлы материалов в позициях — ссылки и пути к платному: бухгалтеру не нужны.
  if (Array.isArray(o.order_items))
    o.order_items = o.order_items.map((it: unknown) => {
      if (!it || typeof it !== "object") return it;
      const copy = { ...(it as Record<string, unknown>) };
      for (const k of Object.keys(copy))
        if (/^(file_(url|path)_|material_files_)/.test(k)) copy[k] = null;
      return copy;
    });
  return o as T;
}

export function redactOrders<T extends object>(orders: T[]): T[] {
  return orders.map(redactOrder);
}

/**
 * Статусы заказа, которые пишутся в from/to/status событий. Всё прочее в
 * этих полях — не статус: например, у email_sent в `to` лежит почта
 * покупателя. Бухгалтер видит только значения из этого списка.
 */
const EVENT_STATUSES = new Set([
  "awaiting_payment",
  "awaiting_confirmation",
  "paid",
  "delivering",
  "delivered",
  "accepted",
  "in_production",
  "ready",
  "rejected",
  "cancelled",
  "expired",
]);

/** Журнал заказа бухгалтеру: только статусы, сумма и способ оплаты, без текстов. */
export function redactEventPayload(
  p: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const k of ["from", "to", "status"])
    if (typeof p[k] === "string" && EVENT_STATUSES.has(p[k] as string)) out[k] = p[k] as string;
  if (typeof p.amount === "number" && Number.isFinite(p.amount)) out.amount = p.amount;
  if (typeof p.method === "string" && /^[a-z_]{1,24}$/.test(p.method)) out.method = p.method;
  return out;
}

/**
 * Поиск заказов бухгалтером — только по номеру заказа: поиск по тексту идёт
 * по имени, телефону и почте, и совпадения подсказывали бы контакты.
 * «#123» → «123»; ноль, пустое и всё прочее — без поиска.
 */
export function accountantSearch(q: string | undefined): string | undefined {
  const m = /^#?0*([1-9]\d{0,9})$/.exec(q?.trim() ?? "");
  return m ? m[1] : undefined;
}
