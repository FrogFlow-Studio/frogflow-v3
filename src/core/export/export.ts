import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { ORDER_STATUS_RU as STATUS_RU } from "@/core/orders/pure";
import { shopDateTime, toCsv, zonedDayToUtc } from "./csv";
import { zipFiles } from "./zip";

export type ExportRange = {
  from?: string | null;
  to?: string | null;
  /** Бухгалтеру: без колонок, по которым можно узнать или найти покупателя. */
  noContacts?: boolean;
};

/** Колонки выгрузки заказов с контактами покупателя — их нет у бухгалтера. */
export const ORDER_CONTACT_COLUMNS = [
  "Покупатель",
  "Username",
  "Telegram ID",
  "Контакт",
  "E-mail",
  "Заметка",
  "Адрес",
  "Комментарий покупателя",
];

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
      // RLS и так отдаёт только свой магазин; фильтр — вторая стена.
      .eq("bot_id", ctx.tenant.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (range.from) q = q.gte("created_at", zonedDayToUtc(range.from, tz));
    if (range.to) q = q.lte("created_at", zonedDayToUtc(range.to, tz, true));
    return q;
  }, "заказы для выгрузки");
  const headers = [
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
  ];
  const table = rows.map((o) => [
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
  ]);
  const keep = headers.map(
    (h) => !range.noContacts || !(ORDER_CONTACT_COLUMNS as readonly string[]).includes(h),
  );
  const csv = toCsv(
    headers.filter((_, i) => keep[i]),
    table.map((r) => r.filter((_, i) => keep[i])),
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
          .eq("bot_id", ctx.tenant.id)
          .order("created_at", { ascending: false })
          .range(from, to),
      "покупатели для выгрузки",
    ),
    pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("telegram_id, total, paid_amount, status, fulfillment_kind, created_at")
          .eq("bot_id", ctx.tenant.id)
          .order("id")
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

/**
 * Каталог — в том же формате, который принимает импорт: выгрузил, поправил
 * цены в Excel, загрузил обратно. Колонка id связывает строку с товаром.
 */
export async function productsCsv(ctx: TenantContext): Promise<{ csv: string; count: number }> {
  const [rows, { data: categories }] = await Promise.all([
    pageAll(
      (from, to) =>
        ctx.db
          .from("products")
          .select(
            "id, name, price, currency, category_ids, description, keywords, is_active, stock_quantity, fulfillment_kind, file_url, file_url_kz, sort_order",
          )
          .eq("bot_id", ctx.tenant.id)
          .order("sort_order")
          .order("name")
          .order("id")
          .range(from, to),
      "товары для выгрузки",
    ),
    ctx.db.from("categories").select("id, name").eq("bot_id", ctx.tenant.id),
  ]);
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const csv = toCsv(
    [
      "id",
      "Название",
      "Цена",
      "Валюта",
      "Категория",
      "Описание",
      "Ключевые слова",
      "В продаже",
      "Остаток",
      "Тип",
      "Ссылка",
      "Ссылка kz",
      "Порядок",
    ],
    rows.map((p) => [
      p.id,
      p.name,
      p.price,
      p.currency,
      (Array.isArray(p.category_ids) ? p.category_ids : [])
        .map((id) => catName.get(String(id)) ?? "")
        .filter(Boolean)
        .join(" / "),
      p.description ?? "",
      p.keywords ?? "",
      p.is_active ? "да" : "нет",
      p.stock_quantity ?? "",
      p.fulfillment_kind === "physical" ? "физический" : "цифровой",
      p.file_url ?? "",
      p.file_url_kz ?? "",
      p.sort_order,
    ]),
  );
  return { csv, count: rows.length };
}

/** Сколько номеров заказов в одном IN: длина адреса запроса PostgREST ограничена. */
const ITEMS_IDS_CHUNK = 200;

/**
 * Позиции заказов: что куплено, сколько и почём. У старых позиций v1 bot_id
 * бывает пустым, поэтому магазин задают номера его заказов, а не bot_id.
 */
export async function orderItemsCsv(ctx: TenantContext): Promise<{ csv: string; count: number }> {
  const orders = await pageAll(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, order_no, display_no")
        .eq("bot_id", ctx.tenant.id)
        .order("id", { ascending: false })
        .range(from, to),
    "заказы для выгрузки позиций",
  );
  const number = new Map(orders.map((o) => [o.id, o.display_no ?? o.order_no ?? o.id]));
  const ids = orders.map((o) => o.id);
  const items: Array<{
    order_id: number;
    name_snapshot: string;
    quantity: number;
    price_snapshot: number;
    product_id: string | null;
    delivered_language: string | null;
  }> = [];
  for (let i = 0; i < ids.length; i += ITEMS_IDS_CHUNK) {
    const chunk = ids.slice(i, i + ITEMS_IDS_CHUNK);
    items.push(
      ...(await pageAll(
        (from, to) =>
          ctx.db
            .from("order_items")
            .select(
              "order_id, name_snapshot, quantity, price_snapshot, product_id, delivered_language",
            )
            .in("order_id", chunk)
            .order("order_id", { ascending: false })
            .order("id")
            .range(from, to),
        "позиции заказов для выгрузки",
      )),
    );
  }
  const csv = toCsv(
    ["Номер заказа", "Товар", "Количество", "Цена", "Сумма", "id товара", "Язык выдачи"],
    items.map((it) => [
      number.get(it.order_id) ?? it.order_id,
      it.name_snapshot,
      it.quantity,
      it.price_snapshot,
      Number(it.price_snapshot) * Number(it.quantity),
      it.product_id ?? "",
      it.delivered_language ?? "",
    ]),
  );
  return { csv, count: items.length };
}

/**
 * Все данные магазина одним архивом: заказы, их позиции, покупатели, каталог.
 * Каждое чтение постраничное и только своего магазина.
 */
export async function allDataZip(
  ctx: TenantContext,
  now = new Date(),
): Promise<{ zip: Buffer; counts: Record<string, number> }> {
  const [orders, items, customers, products] = await Promise.all([
    ordersCsv(ctx),
    orderItemsCsv(ctx),
    customersCsv(ctx),
    productsCsv(ctx),
  ]);
  const files = {
    "orders.csv": orders,
    "order_items.csv": items,
    "customers.csv": customers,
    "products.csv": products,
  };
  return {
    zip: zipFiles(
      Object.entries(files).map(([name, f]) => ({ name, data: f.csv })),
      now,
    ),
    counts: Object.fromEntries(Object.entries(files).map(([name, f]) => [name, f.count])),
  };
}

/**
 * Кто выгружает контакты покупателей (полный архив, покупатели, заказы с
 * именем и телефоном): роль с доступом к покупателям — владелец или
 * менеджер, а не «только просмотр». Каталог контактов не содержит.
 */
export const CONTACTS_MIN_ROLE = "manager" as const;
