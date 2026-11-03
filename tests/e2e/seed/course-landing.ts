/**
 * Страница курса на сайте (core/courses/landing): школа с двумя курсами —
 * у одного страница включена (шапка, блоки, программа по модулям), у другого
 * записи нет и товар выглядит как раньше (course-landing.spec.ts). Вторая
 * школа — без витрины на сайте: открыта только страница курса со «Страницей
 * курса», покупка — в Telegram.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const product = (botId: string, id: string, name: string, now: string) => ({
  bot_id: botId,
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

/** Школа: с витриной на сайте (каталог, корзина) или только с курсами. */
const school = (o: {
  id: string;
  slug: string;
  storefront: boolean;
  login: string;
  tg: number;
  now: string;
}) => ({
  id: o.id,
  bot_name: o.storefront ? "Школа ресниц E2E" : "Школа без витрины E2E",
  status: "active",
  vertical: "courses",
  modules: { shop: true, web_storefront: o.storefront, courses: true },
  settings: {
    served_by: "v2",
    default_locale: "ru",
    slug: o.slug,
    telegram: { username: F.LANDING_BOT_USERNAME, webhook_ok: true },
    admin: { username: o.login, password_hash: hash(F.LANDING_SELLER_PASSWORD) },
  },
  paused_message: null,
  owner_telegram_id: o.tg,
  owner_name: "Преподаватель Л1",
  app_url: null,
  archived_at: null,
  bot_token: encrypt(`${700000000 + o.tg}:E2E-lash-token`, F.SECRETS_KEY),
  subscription_plan: "basic",
  subscription_expires_at: null,
  created_at: o.now,
});

export function seedCourseLanding(db: StubDb, now: string) {
  add(db, "bots", [
    school({
      id: F.LANDING_SHOP_ID,
      slug: F.LANDING_SHOP_SLUG,
      storefront: true,
      login: F.LANDING_SELLER_LOGIN,
      tg: 500000071,
      now,
    }),
    school({
      id: F.LANDING_BARE_ID,
      slug: F.LANDING_BARE_SLUG,
      storefront: false,
      login: `${F.LANDING_SELLER_LOGIN}-bare`,
      tg: 500000072,
      now,
    }),
  ]);
  add(db, "products", [
    product(F.LANDING_SHOP_ID, F.LANDING_COURSE_ID, F.LANDING_COURSE_NAME, now),
    product(F.LANDING_SHOP_ID, F.LANDING_PLAIN_ID, F.LANDING_PLAIN_NAME, now),
    product(F.LANDING_BARE_ID, F.LANDING_BARE_COURSE_ID, F.LANDING_COURSE_NAME, now),
    product(F.LANDING_BARE_ID, F.LANDING_BARE_PLAIN_ID, F.LANDING_PLAIN_NAME, now),
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
  const row = (bot_id: string, key: string, value: object) => ({
    bot_id,
    key,
    value: JSON.stringify(value),
    updated_at: now,
  });
  add(db, "app_settings", [
    row(F.LANDING_SHOP_ID, `course_${F.LANDING_COURSE_ID}`, course),
    row(F.LANDING_SHOP_ID, `course_${F.LANDING_PLAIN_ID}`, course),
    row(F.LANDING_SHOP_ID, `course_landing_${F.LANDING_COURSE_ID}`, landing),
    row(F.LANDING_BARE_ID, `course_${F.LANDING_BARE_COURSE_ID}`, course),
    row(F.LANDING_BARE_ID, `course_${F.LANDING_BARE_PLAIN_ID}`, course),
    row(F.LANDING_BARE_ID, `course_landing_${F.LANDING_BARE_COURSE_ID}`, landing),
  ]);
}
