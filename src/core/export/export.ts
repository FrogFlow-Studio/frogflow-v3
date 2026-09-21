import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { shopDateTime, toCsv, zonedDayToUtc } from "./csv";

const STATUS_RU: Record<string, string> = {
  awaiting_payment: "ожидает оплаты",
  awaiting_confirmation: "чек на проверке",
  delivering: "выдаётся",
  delivered: "выдан",
  paid: "оплачен",
  rejected: "отклонён",
  cancelled: "отменён",
  accepted: "принят в работу",
  in_production: "в работе",
  ready: "готов",
};

export type ExportRange = { from?: string | null; to?: string | null };

/** Заказы за период (границы — дни в поясе клиента, включительно). */
export async function ordersCsv(
  ctx: TenantContext,
  range: ExportRange = {},
): Promise<{ csv: string; count: number }> {
  const tz = ctx.timezone;
  const rows = await pageAll((from, to) => {
    let q = ctx.db
      .from("orders")
      .select(
        "id, order_no, display_no, created_at, status, total, paid_amount, currency, discount_amount, gift_certificate_discount, points_used, promo_code, display_name, username, telegram_id, platform, contact, customer_email, country_name, admin_note, fulfillment_kind, fulfillment_type, fulfillment_at, fulfillment_address, fulfillment_note, delivery_zone_name, delivery_fee",
      )
      .order("created_at", { ascending: false })
      .range(from, to);
    if (range.from) q = q.gte("created_at", zonedDayToUtc(range.from, tz));
    if (range.to) q = q.lte("created_at", zonedDayToUtc(range.to, tz, true));
    return q;
  }, "заказы для выгрузки");
  const csv = toCsv(
    [
      "Номер",
      "Дата",
      "Статус",
      "Сумма",
      "Внесено",
      "Валюта",
      "Скидка",
      "Сертификат",
      "Баллы",
      "Промокод",
      "Покупатель",
      "Username",
      "Telegram ID",
      "Канал",
      "Контакт",
      "E-mail",
      "Страна",
      "Заметка",
      "Тип товара",
      "Получение",
      "Дата получения",
      "Адрес",
      "Комментарий покупателя",
      "Зона доставки",
      "Комиссия доставки",
    ],
    rows.map((o) => [
      o.display_no ?? o.order_no ?? o.id,
      shopDateTime(o.created_at, tz),
      STATUS_RU[o.status] ?? o.status,
      o.total,
      o.paid_amount ?? "",
      o.currency,
      o.discount_amount ?? "",
      o.gift_certificate_discount ?? "",
      o.points_used ?? "",
      o.promo_code ?? "",
      o.display_name,
      o.username,
      o.telegram_id,
      o.platform ?? "telegram",
      o.contact,
      o.customer_email ?? "",
      o.country_name,
      o.admin_note,
      o.fulfillment_kind === "physical" ? "физический" : "цифровой",
      o.fulfillment_type === "delivery"
        ? "доставка"
        : o.fulfillment_type === "pickup"
          ? "самовывоз"
          : "",
      o.fulfillment_at ? String(o.fulfillment_at).slice(0, 10) : "",
      o.fulfillment_address ?? "",
      o.fulfillment_note ?? "",
      o.delivery_zone_name ?? "",
      o.delivery_fee ?? "",
    ]),
  );
  return { csv, count: rows.length };
}

/** Клиентская база со счётчиком заказов и суммой покупок. */
export async function customersCsv(ctx: TenantContext): Promise<{ csv: string; count: number }> {
  const tz = ctx.timezone;
  const [users, orders] = await Promise.all([
    pageAll(
      (from, to) =>
        ctx.db
          .from("bot_users")
          .select(
            "user_key, platform, telegram_id, first_name, last_name, username, contact_phone, email, language_code, loyalty_points, created_at",
          )
          .order("created_at", { ascending: false })
          .range(from, to),
      "покупатели для выгрузки",
    ),
    pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("telegram_id, total, paid_amount, status, fulfillment_kind, created_at")
          .range(from, to),
      "заказы для выгрузки покупателей",
    ),
  ]);
  const stats = new Map<number, { count: number; sum: number; last: string | null }>();
  for (const o of orders) {
    const id = Number(o.telegram_id);
    const cur = stats.get(id) ?? { count: 0, sum: 0, last: null };
    cur.count += 1;
    // Физический — реально внесённое на любой стадии; цифровой — выданный.
    if (o.fulfillment_kind === "physical") cur.sum += Number(o.paid_amount) || 0;
    else if (o.status === "delivered") cur.sum += Number(o.total) || 0;
    if (!cur.last || o.created_at > cur.last) cur.last = o.created_at;
    stats.set(id, cur);
  }
  const csv = toCsv(
    [
      "Канал",
      "Telegram ID",
      "Имя",
      "Фамилия",
      "Username",
      "Телефон",
      "E-mail",
      "Язык",
      "Баллы",
      "Регистрация",
      "Заказов",
      "Куплено на",
      "Последний заказ",
    ],
    users.map((u) => {
      const st = stats.get(Number(u.telegram_id));
      return [
        u.platform ?? "telegram",
        u.telegram_id,
        u.first_name,
        u.last_name,
        u.username,
        u.contact_phone,
        u.email ?? "",
        u.language_code,
        u.loyalty_points ?? 0,
        shopDateTime(u.created_at, tz),
        st?.count ?? 0,
        st?.sum ?? 0,
        shopDateTime(st?.last, tz),
      ];
    }),
  );
  return { csv, count: users.length };
}
