/**
 * Страница курса на сайте (core/courses/landing): школа с двумя курсами —
 * у одного страница включена (шапка, блоки, программа по модулям), у другого
 * записи нет и товар выглядит как раньше (course-landing.spec.ts).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const mine = <T extends object>(r: T) => ({ bot_id: F.LANDING_SHOP_ID, ...r });

const product = (id: string, name: string, now: string) =>
  mine({
    id,
    name,
    description: "Онлайн-курс.",
    price: 10000,
    currency: "KGS",
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
  });

export function seedCourseLanding(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.LANDING_SHOP_ID,
      bot_name: "Школа ресниц E2E",
      status: "active",
      vertical: "courses",
      modules: { shop: true, web_storefront: true, courses: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        slug: F.LANDING_SHOP_SLUG,
        telegram: { username: F.LANDING_BOT_USERNAME, webhook_ok: true },
        admin: {
          username: F.LANDING_SELLER_LOGIN,
          password_hash: hash(F.LANDING_SELLER_PASSWORD),
        },
      },
      paused_message: null,
      owner_telegram_id: 500000071,
      owner_name: "Преподаватель Л1",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000071:E2E-lash-token", F.SECRETS_KEY),
      subscription_plan: "basic",
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  add(db, "products", [
    product(F.LANDING_COURSE_ID, F.LANDING_COURSE_NAME, now),
    product(F.LANDING_PLAIN_ID, F.LANDING_PLAIN_NAME, now),
  ]);
  const lessons = [
    { title: "Модуль 1 · 1.1. Знакомство", preview: true, text: "Открытый урок." },
    { title: "Модуль 1 · 1.2. Материалы" },
    { title: "Модуль 2 · 2.1. Классика 1:1" },
  ].map((l, i) => ({
    id: F.LANDING_LESSONS[i],
    text: "",
    files: [],
    link: "https://youtu.be/dQw4w9WgXcQ",
    ...l,
  }));
  const course = { schedule: { mode: "all" }, lessons };
  const landing = {
    on: true,
    theme: "bold",
    accent: "#c2185b",
    headline: "Ресницы с нуля Л1",
    subtitle: "Три урока в двух модулях",
    order: ["faq", "program", "learn", "authors", "works", "quotes"],
    hidden: ["quotes"],
    authors: [{ photo: null, name: "Жази Л1", text: "Мастер и преподаватель" }],
    learn: ["Классика 1:1 Л1"],
    works: [],
    quotes: [{ name: "Аня", text: "Скрытая цитата Л1" }],
    faq: [{ q: "Сколько длится доступ Л1?", a: "Бессрочно." }],
  };
  add(db, "app_settings", [
    mine({ key: `course_${F.LANDING_COURSE_ID}`, value: JSON.stringify(course), updated_at: now }),
    mine({ key: `course_${F.LANDING_PLAIN_ID}`, value: JSON.stringify(course), updated_at: now }),
    mine({
      key: `course_landing_${F.LANDING_COURSE_ID}`,
      value: JSON.stringify(landing),
      updated_at: now,
    }),
  ]);
}
