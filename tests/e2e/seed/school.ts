/**
 * Онлайн-школа: отдельный магазин ниши «Онлайн-школа» с курсом (поток начался
 * вчера, уроки раз в неделю, задание в первом уроке) и выданным заказом —
 * карточка курса на витрине и страница курса с ДЗ (school.spec.ts).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt } from "./util.ts";

const school = <T extends object>(r: T) => ({ bot_id: F.SCHOOL_ID, ...r });
/** «YYYY-MM-DDTHH:MM» — местное время старта потока. */
const local = (d: Date) => d.toISOString().slice(0, 16);

export function seedSchool(db: StubDb, now: string) {
  const day = 86_400_000;
  const t = Date.parse(now);
  add(db, "bots", [
    {
      id: F.SCHOOL_ID,
      bot_name: "Школа E2E",
      status: "active",
      vertical: "courses",
      modules: { shop: true, web_storefront: true, courses: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.SCHOOL_SLUG,
        telegram: { username: "e2e_school_bot", webhook_ok: true },
      },
      paused_message: null,
      owner_telegram_id: 500000005,
      owner_name: "Преподаватель E2E",
      app_url: null,
      archived_at: null,
      bot_token: encrypt(F.SCHOOL_BOT_TOKEN, F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "products", [
    school({
      id: F.SCHOOL_COURSE_ID,
      name: F.SCHOOL_COURSE_NAME,
      description: "Курс для начинающих художников.",
      price: 4900,
      currency: "KZT",
      country_prices: {},
      is_active: true,
      category_ids: [],
      category_id: null,
      fulfillment_kind: "digital",
      stock_quantity: null,
      lead_time_days: null,
      file_path: null,
      file_name: null,
      file_url: "frogflow:course",
      file_path_kz: null,
      file_name_kz: null,
      file_url_kz: null,
      rating_avg: null,
      rating_count: 0,
      sort_order: 0,
      created_at: now,
    }),
  ]);
  const course = {
    schedule: { mode: "drip", everyDays: 7 },
    lessons: [
      {
        id: F.SCHOOL_LESSON_1,
        title: "Кисти и краски",
        text: "Разбираем инструменты.",
        files: [],
        link: "https://youtu.be/dQw4w9WgXcQ",
        homework: "Нарисуйте круг и пришлите фото.",
      },
      { id: F.SCHOOL_LESSON_2, title: "Первый образ", text: "Бабочка.", files: [], link: null },
    ],
    cohorts: [
      {
        id: F.SCHOOL_COHORT_ID,
        title: "Октябрь",
        start: local(new Date(t - day)),
        enrollUntil: new Date(t + 7 * day).toISOString().slice(0, 10),
      },
    ],
  };
  add(db, "app_settings", [
    school({ key: `course_${F.SCHOOL_COURSE_ID}`, value: JSON.stringify(course), updated_at: now }),
  ]);
  F.SCHOOL_ITEM_IDS.forEach((itemId, i) => {
    const orderId = 50501 + i;
    add(db, "orders", [
      school({
        id: orderId,
        order_no: i + 1,
        display_no: null,
        status: "delivered",
        platform: "telegram",
        telegram_id: 505050 + i,
        user_key: `tg_${505050 + i}`,
        display_name: "Мария",
        username: null,
        total: 4900,
        currency: "KZT",
        fulfillment_kind: "digital",
        created_at: now,
        updated_at: now,
      }),
    ]);
    add(db, "order_items", [
      school({
        id: itemId,
        order_id: orderId,
        product_id: F.SCHOOL_COURSE_ID,
        product_variant_id: null,
        name_snapshot: F.SCHOOL_COURSE_NAME,
        quantity: 1,
        price_snapshot: 4900,
      }),
    ]);
  });
}
