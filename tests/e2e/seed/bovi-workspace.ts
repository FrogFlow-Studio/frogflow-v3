/**
 * Рабочее место консультанта без продаж (bovi-workspace.spec.ts): консультант
 * по прайсу с модулем чата, задачами (две открытые, одна сделанная), журналом
 * ответов за сегодня и вчера, базой знаний и фото товаров.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt, hash } from "./util.ts";

const own = <T extends object>(r: T) => ({ bot_id: F.BOVI_WS_ID, ...r });
const item = (id: string, name: string, price: number, colors: string[] = []) => ({
  id,
  name,
  category: "Bovi",
  size: "",
  colors,
  price_kzt: price,
  stock: true,
});

export function seedBoviWorkspace(db: StubDb, now: string) {
  const t = Date.parse(now);
  const ago = (min: number) => new Date(t - min * 60_000).toISOString();
  add(db, "bots", [
    {
      id: F.BOVI_WS_ID,
      bot_name: F.BOVI_WS_NAME,
      status: "active",
      vertical: "consultant",
      modules: { instagram: true, whatsapp: true, manager_chat: true },
      settings: {
        served_by: "v2",
        default_locale: "ru",
        telegram: { username: "e2e_bovi_ws_bot", webhook_ok: true },
        consultant_pricelist: { enabled: true },
        admin: { username: F.BOVI_WS_LOGIN, password_hash: hash(F.BOVI_WS_PASSWORD) },
      },
      paused_message: null,
      owner_telegram_id: 500000232,
      owner_name: "Менеджер BOVI",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000232:E2E-bovi-ws-token", F.SECRETS_KEY),
      subscription_plan: null,
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
  const catalog = [
    item("sat-1", "Bovi Satin комплект евро", 74000, ["серый", "белый"]),
    item("sat-2", "Bovi Satin комплект семейный", 89000, ["серый"]),
    item("tw-1", "Uchino Zero Twist полотенце 70x140", 18000),
    item("tw-2", "Uchino Zero Twist полотенце 50x90", 9000),
  ];
  const igKey = "instagram:e2e-bovi-ws-ig";
  const waKey = "whatsapp:e2e-bovi-ws-wa";
  const doneKey = "instagram:e2e-bovi-ws-done";
  add(db, "app_settings", [
    own({ key: "shop_name", value: "BOVI", updated_at: now }),
    own({ key: "consultant_enabled", value: "true", updated_at: now }),
    own({ key: "consultant_catalog_json", value: JSON.stringify(catalog), updated_at: now }),
    own({
      key: "consultant_catalog_meta",
      value: JSON.stringify({ count: catalog.length, importedAt: ago(60 * 24 * 2), source: "csv" }),
      updated_at: now,
    }),
    own({
      key: "consultant_vtb_buy_rate",
      value: JSON.stringify({ rate: 5.92, updatedAt: ago(30), source: "manual" }),
      updated_at: now,
    }),
    own({
      key: "consultant_knowledge_json",
      value: JSON.stringify([
        {
          id: "kb-ws-1",
          title: "Фабрики и страны",
          tags: ["бренд", "португалия", "турция"],
          content: "Bovi шьёт в Португалии и Турции.",
          updatedAt: now,
        },
        {
          id: "kb-ws-2",
          title: F.BOVI_WS_ARTICLE,
          tags: ["стирка", "уход", "сатин"],
          content: "Стирать при 40°, без отбеливателя, гладить с изнанки.",
          updatedAt: now,
        },
        {
          id: "kb-ws-3",
          title: F.BOVI_WS_UNTAGGED,
          tags: [],
          content: "Возврат 14 дней при сохранной упаковке.",
          updatedAt: now,
        },
      ]),
      updated_at: now,
    }),
    own({
      key: "consultant_product_media_json",
      value: JSON.stringify([
        {
          id: "pm-ws-1",
          match: "Bovi Satin",
          path: "consultant/e2e-satin.mp4",
          kind: "video",
          createdAt: now,
        },
        {
          id: "pm-ws-2",
          match: "Bovi Satn",
          path: "consultant/e2e-typo.mp4",
          kind: "video",
          createdAt: now,
        },
      ]),
      updated_at: now,
    }),
    own({
      key: "consultant_tasks_json",
      value: JSON.stringify([
        {
          id: "tsk_ws_ig",
          at: ago(12),
          userKey: igKey,
          reason: "purchase",
          text: F.BOVI_WS_IG_TASK,
          name: F.BOVI_WS_IG_NAME,
          channel: "instagram",
          products: ["Bovi Satin комплект евро, серый — 74 000 ₸"],
          link: "https://ig.me/m/e2e_bovi_ws_ig",
          done: false,
        },
        {
          id: "tsk_ws_wa",
          at: ago(40),
          userKey: waKey,
          reason: "wholesale",
          text: F.BOVI_WS_WA_TASK,
          name: F.BOVI_WS_WA_NAME,
          channel: "whatsapp",
          link: "https://wa.me/79990000000",
          done: false,
        },
        {
          id: "tsk_ws_done",
          at: ago(60 * 20),
          userKey: doneKey,
          reason: "purchase",
          text: "Подушку Medium 50×70 заберёт в бутике",
          name: F.BOVI_WS_DONE_NAME,
          channel: "instagram",
          done: true,
          doneAt: ago(60 * 19),
          doneVia: "instagram",
        },
      ]),
      updated_at: now,
    }),
  ]);
  const users = [
    { id: F.BOVI_WS_IG_ID, key: igKey, platform: "instagram", name: F.BOVI_WS_IG_NAME, n: 1 },
    { id: F.BOVI_WS_WA_ID, key: waKey, platform: "whatsapp", name: F.BOVI_WS_WA_NAME, n: 2 },
    { id: -923003, key: doneKey, platform: "instagram", name: F.BOVI_WS_DONE_NAME, n: 3 },
  ];
  add(
    db,
    "bot_users",
    users.map((u) =>
      own({
        id: `e2e23000-0000-4000-8000-0000000003b${u.n}`,
        user_key: u.key,
        telegram_id: u.id,
        platform: u.platform,
        first_name: u.name,
      }),
    ),
  );
  add(
    db,
    "manager_chat_state",
    users.map((u) =>
      own({
        telegram_id: u.id,
        active: false,
        last_message_at: u.n === 3 ? ago(60 * 19) : ago(10 + u.n),
        last_message_preview: u.n === 1 ? "Беру комплект, как оплатить?" : "Здравствуйте",
        last_message_direction: "in",
        unread_count: u.n === 3 ? 0 : 1,
      }),
    ),
  );
  add(db, "manager_chat_messages", [
    own({
      id: "e2e23000-0000-4000-8000-0000000003c1",
      telegram_id: F.BOVI_WS_IG_ID,
      direction: "in",
      sender: "customer",
      text: F.BOVI_WS_IG_QUESTION,
      created_at: ago(20),
    }),
    own({
      id: "e2e23000-0000-4000-8000-0000000003c2",
      telegram_id: F.BOVI_WS_IG_ID,
      direction: "out",
      sender: "bot",
      text: F.BOVI_WS_IG_ANSWER,
      created_at: ago(19),
    }),
    own({
      id: "e2e23000-0000-4000-8000-0000000003c3",
      telegram_id: F.BOVI_WS_IG_ID,
      direction: "in",
      sender: "customer",
      text: "Беру комплект, как оплатить?",
      created_at: ago(13),
    }),
  ]);
  const run = (n: number, at: string, over: Record<string, unknown>) =>
    own({
      id: `e2e23000-0000-4000-8000-0000000003d${n}`,
      message_id: `m-ws-${n}`,
      event_id: null,
      platform_message_id: null,
      conversation_id: "conv-ws-ig",
      account_id: null,
      user_key: igKey,
      direction: "in",
      source: "zernio",
      status: "sent",
      incoming_text: null,
      reply_text: null,
      reply_kind: "answer",
      reply_fingerprint: null,
      outbound_message_id: null,
      model: null,
      prompt_version: null,
      catalog_version: null,
      rate_value: null,
      rate_updated_at: null,
      rate_source: null,
      tool_trace: [],
      token_usage: {},
      validator_result: {},
      error_code: null,
      error_message: null,
      attempt_count: 1,
      received_at: at,
      claimed_at: at,
      sent_at: at,
      completed_at: at,
      next_retry_at: null,
      created_at: at,
      updated_at: at,
      ...over,
    });
  add(db, "consultant_message_runs", [
    run(1, ago(20), { incoming_text: F.BOVI_WS_IG_QUESTION, reply_text: F.BOVI_WS_IG_ANSWER }),
    run(2, ago(13), {
      incoming_text: "Беру комплект, как оплатить?",
      reply_text: "Передаю менеджеру — он подскажет оплату.",
      reply_kind: "handoff:purchase",
    }),
    run(3, ago(5), {
      incoming_text: "Жду",
      status: "cancelled",
      reply_kind: "paused",
    }),
  ]);
}
