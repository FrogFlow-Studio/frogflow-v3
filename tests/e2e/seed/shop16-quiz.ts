/**
 * Квиз-подбор на витрине (shop16-quiz.spec.ts): магазин «Кондитерская К16» с квизом
 * («Что любите?» → шоколад или яблоко, «Повод?» → день рождения или чай) и двумя товарами,
 * плюс такой же магазин, ещё живущий на прежней платформе (served_by = v1).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, nulls } from "./util.ts";

const QUIZ = {
  intro: "Подберём десерт за минуту",
  questions: [
    {
      text: "Что любите?",
      options: [
        { label: "Шоколад", tags: "шоколад" },
        { label: "Яблоки", tags: "яблоч" },
      ],
    },
    {
      text: "Какой повод?",
      options: [
        { label: "День рождения", tags: "торт" },
        { label: "К чаю", tags: "пирог" },
      ],
    },
  ],
};

export function seedShop16Quiz(db: StubDb, now: string) {
  const bot = (id: string, slug: string, served: "v1" | "v2", n: number) => ({
    id,
    bot_name: F.QUIZ16_SHOP_NAME,
    status: "active",
    vertical: "digital",
    modules: { shop: true, web_storefront: true, quiz: true },
    settings: {
      served_by: served,
      default_locale: "ru",
      slug,
      telegram: { username: `e2e_quiz16_bot${n}`, webhook_ok: true },
    },
    paused_message: null,
    owner_telegram_id: 500000200 + n,
    owner_name: "Продавец К16",
    app_url: null,
    archived_at: null,
    bot_token: encrypt(`70000020${n}:E2E-quiz16-token`, F.SECRETS_KEY),
    subscription_plan: "business",
    subscription_expires_at: null,
    created_at: now,
  });
  add(db, "bots", [
    bot(F.QUIZ16_SHOP_ID, F.QUIZ16_SHOP_SLUG, "v2", 1),
    bot(F.QUIZ16_V1_SHOP_ID, F.QUIZ16_V1_SHOP_SLUG, "v1", 2),
  ]);
  for (const id of [F.QUIZ16_SHOP_ID, F.QUIZ16_V1_SHOP_ID]) {
    const own = <T extends object>(r: T) => ({ bot_id: id, ...r });
    add(db, "app_settings", [
      own({ key: "shop_name", value: F.QUIZ16_SHOP_NAME, updated_at: now }),
      own({ key: "quiz", value: JSON.stringify(QUIZ), updated_at: now }),
    ]);
    const product = (pid: string, name: string, sort: number) =>
      own({
        id: id === F.QUIZ16_SHOP_ID ? pid : pid.replace(/16b/, "16c"),
        name,
        description: "Свежая выпечка.",
        price: 5000,
        currency: "KZT",
        country_prices: {},
        is_active: true,
        category_ids: [],
        fulfillment_kind: "physical",
        stock_quantity: null,
        lead_time_days: null,
        ...nulls([
          "file_path",
          "file_name",
          "file_url",
          "file_path_kz",
          "file_name_kz",
          "file_url_kz",
          "rating_avg",
        ]),
        rating_count: 0,
        sort_order: sort,
        created_at: now,
      });
    add(db, "products", [
      product(F.QUIZ16_CAKE_ID, F.QUIZ16_CAKE_NAME, 0),
      product(F.QUIZ16_PIE_ID, F.QUIZ16_PIE_NAME, 1),
    ]);
  }
}
