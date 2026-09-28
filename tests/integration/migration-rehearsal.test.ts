import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { liveReady, DEMO_BOT, TEST_TG_ID, dropOrderNotify } from "./live";
import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";
import {
  invalidateTenantDirectory,
  requireTenant,
  tenantContext,
  tenantDirectory,
} from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import { pageAll } from "@/core/db/page";
import { getCustomerByTelegramId } from "@/core/customers/customers";
import { effectiveModules, keptModules } from "@/core/plans/plans";
import { PLAN_TIERS, nicheForVertical, parsePlan } from "@/core/plans/registry";
import { moduleDef, type ModuleKey } from "@/core/modules/registry";
import { preflight } from "@/app/operator/migration.server";
import { webhookState } from "@/app/operator/operator.server";
import { preflightBlockers } from "@/core/tenant/preflight";
import { telegramWebhookSecret, telegramWebhookUrl } from "@/channels/telegram/secret";
import { Route as BotsRoute } from "@/routes/api/operator/bots";
import { Route as TelegramRoute } from "@/routes/api/telegram.$botId";

/**
 * Репетиция переезда по docs/MIGRATION.md на демо-клиенте, тем же путём, что
 * scripts/onboard.mjs: POST /api/operator/bots → проверка перед переездом →
 * вебхук v2 → покупатель проходит заказ через вебхук с подписью → продавец
 * подтверждает → откат {served_by: "v1"} → вебхук 503.
 *
 * Заодно — что новое в v2 (#142–#174) переезд не ломает: модули, тариф,
 * сохранённые сверх плана, связь «Несколько ботов» и покупатели с баллами
 * лояльности остаются как были; ни один крон не видит клиента, пока он на v1.
 *
 * Подменены только Telegram (у демо нет своего бота) и проверка пароля
 * оператора (учётка оператора живёт в базе, тесту её пароль не нужен).
 * Строка bots, admin_chat_id, реквизиты, товар, заказ и журнал демо-клиента
 * возвращаются как были.
 */
vi.mock("@/app/operator/credentials.server", () => ({ verifyOperator: async () => true }));
vi.mock("@/app/auth/login-guard.server", () => ({
  clientIp: () => "127.0.0.1",
  loginDelay: async () => undefined,
  loginLocked: async () => false,
  recordLogin: async () => undefined,
}));

const ACTOR = "api:rehearsal";
const TG = TEST_TG_ID + 63;
const SELLER = TEST_TG_ID + 64;
/** Покупатель «из v1» с баллами лояльности и незаконченным диалогом. */
const LOYAL = TEST_TG_ID + 65;
const LOYAL_POINTS = 120;
/** Связь «Несколько ботов» на время репетиции — как у VIP-клиента с двумя ботами. */
const GROUP = "0e5c1f2a-7b3d-4c8e-9f10-5e6a7b8c9d0e";
const TOKEN = `123456:${"r".repeat(35)}`;
const PROBE = "v2 репетиция · материал";
const FILE_PATH = `${DEMO_BOT}/v2-rehearsal/material.pdf`;
const COUNTRY = "Казахстан (v2 rehearsal)";

let saved: {
  bot_token: string | null;
  settings: Json;
  owner_telegram_id: number | null;
} | null = null;
let prevAdmins: { value: string | null } | null = null;
let productId = "";
/** Что у клиента было на v1 — сверяется после переезда и после отката. */
let v1Snapshot: {
  modules: Json | null;
  subscription_plan: string | null;
  billing: Json | null;
  multi_bot: Json | null;
  customers: string;
} | null = null;
const tg: Array<[string, Record<string, unknown>]> = [];
let webhookUrlAtTelegram = "https://v1.example/api/telegram";
const realFetch = globalThis.fetch;
const receipt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);

type Handler = (a: { request: Request; params?: Record<string, string> }) => Promise<Response>;
const handler = (r: unknown) =>
  (r as { options: { server: { handlers: { POST: Handler } } } }).options.server.handlers.POST;

async function onboard(body: Record<string, unknown>) {
  const res = await handler(BotsRoute)({
    request: new Request("https://x/api/operator/bots", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Basic " + Buffer.from("operator:x").toString("base64"),
      },
      body: JSON.stringify(body),
    }),
  });
  return {
    status: res.status,
    json: (await res.json().catch(() => null)) as Record<string, unknown>,
  };
}

let updateId = Date.now();
async function webhook(update: Record<string, unknown>) {
  return handler(TelegramRoute)({
    request: new Request(`https://x/api/telegram/${DEMO_BOT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": telegramWebhookSecret(DEMO_BOT, env().WEBHOOK_SECRET),
      },
      body: JSON.stringify({ update_id: ++updateId, ...update }),
    }),
    params: { botId: DEMO_BOT },
  });
}
const from = (id: number) => ({ id, first_name: "Покупатель", language_code: "ru" });
const msg = (extra: Record<string, unknown>, who = TG) => ({
  message: { message_id: 1, chat: { id: who, type: "private" }, from: from(who), ...extra },
});
const press = (data: string, who = TG) => ({
  callback_query: { id: `cq-${data}`, from: from(who), message: { chat: { id: who } }, data },
});
function button(re: RegExp, chat = TG): string | null {
  for (let i = tg.length - 1; i >= 0; i--) {
    const [, p] = tg[i]!;
    if (String(p.chat_id) !== String(chat)) continue;
    const kb = (p.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> })
      ?.inline_keyboard;
    const hit = kb?.flat().find((b) => b.callback_data && re.test(b.callback_data));
    if (hit) return hit.callback_data!;
  }
  return null;
}
async function orderStatus(): Promise<{ id: number; status: string } | null> {
  const { data } = await serviceDb()
    .from("orders")
    .select("id, status")
    .eq("bot_id", DEMO_BOT)
    .eq("telegram_id", TG)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 40 && !(await check()); i++) await new Promise((r) => setTimeout(r, 250));
}

async function cleanup() {
  const db = serviceDb();
  const { data: orders } = await db
    .from("orders")
    .select("id")
    .eq("bot_id", DEMO_BOT)
    .eq("telegram_id", TG);
  for (const { id } of orders ?? []) {
    const { data: proofs } = await db.storage
      .from("payment-proofs")
      .list(`${DEMO_BOT}/order-${id}`);
    if (proofs?.length)
      await db.storage
        .from("payment-proofs")
        .remove(proofs.map((f) => `${DEMO_BOT}/order-${id}/${f.name}`));
    await dropOrderNotify(id);
    await db.from("zernio_logs").delete().eq("bot_id", DEMO_BOT).like("event_id", `order:${id}:%`);
    await db.from("order_items").delete().eq("order_id", id);
    await db.from("orders").delete().eq("id", id);
  }
  await db.from("zernio_logs").delete().eq("bot_id", DEMO_BOT).like("event_id", `tg:${DEMO_BOT}:%`);
  await db.from("cart_items").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  // Модуль «чат с менеджером» у демо включён: реплики покупателя пишутся в журнал чата.
  await db
    .from("manager_chat_messages")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .in("telegram_id", [TG, SELLER]);
  await db
    .from("manager_chat_state")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .in("telegram_id", [TG, SELLER]);
  await db.from("bot_users").delete().eq("bot_id", DEMO_BOT).in("telegram_id", [TG, SELLER, LOYAL]);
  const { data: probes } = await db
    .from("products")
    .select("id")
    .eq("bot_id", DEMO_BOT)
    .eq("name", PROBE);
  for (const { id } of probes ?? [])
    await db.from("product_material_files").delete().eq("product_id", id);
  await db.from("products").delete().eq("bot_id", DEMO_BOT).eq("name", PROBE);
  await db.from("payment_methods").delete().eq("bot_id", DEMO_BOT).eq("country_name", COUNTRY);
  await db.storage.from("product-files").remove([FILE_PATH]);
  await db.from("bot_events").delete().eq("bot_id", DEMO_BOT).in("actor", [ACTOR, "api:operator"]);
}

/**
 * Покупатели клиента одной строкой: число, сумма баллов и хэш пар
 * «ключ — баллы». Читается постранично: у AATeach больше 10 000 покупателей.
 */
async function customersFingerprint(read: "service" | "v2"): Promise<string> {
  const { createHash } = await import("node:crypto");
  const db = read === "service" ? serviceDb() : tenantContext(await tenant()).db;
  const rows = await pageAll((from, to) => {
    let q = db.from("bot_users").select("user_key, loyalty_points");
    if (read === "service") q = q.eq("bot_id", DEMO_BOT);
    return q.order("user_key").range(from, to);
  }, "покупатели для сверки");
  const sum = rows.reduce((n, r) => n + (Number(r.loyalty_points) || 0), 0);
  const h = createHash("sha256");
  for (const r of rows) h.update(`${r.user_key}:${r.loyalty_points ?? 0}\n`);
  return `${rows.length} покупателей, ${sum} баллов, ${h.digest("hex").slice(0, 16)}`;
}

async function tenant() {
  invalidateTenantDirectory();
  return requireTenant({ by: "id", value: DEMO_BOT });
}

async function snapshot() {
  const { data } = await serviceDb()
    .from("bots")
    .select("modules, subscription_plan, settings")
    .eq("id", DEMO_BOT)
    .single();
  const st = (data!.settings ?? {}) as Record<string, Json>;
  return {
    modules: data!.modules,
    subscription_plan: data!.subscription_plan,
    billing: st.billing ?? null,
    multi_bot: st.multi_bot ?? null,
    customers: await customersFingerprint("service"),
  };
}

describe.skipIf(!liveReady)("репетиция переезда на демо-клиенте", () => {
  beforeAll(async () => {
    const db = serviceDb();
    const { data } = await db
      .from("bots")
      .select("bot_token, settings, owner_telegram_id")
      .eq("id", DEMO_BOT)
      .single();
    saved = {
      bot_token: data!.bot_token,
      settings: data!.settings,
      owner_telegram_id: data!.owner_telegram_id,
    };
    const { data: admins } = await db
      .from("app_settings")
      .select("value")
      .eq("bot_id", DEMO_BOT)
      .eq("key", "admin_chat_id")
      .maybeSingle();
    prevAdmins = admins ? { value: admins.value } : null;
    await cleanup();

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(env().TELEGRAM_API_BASE)) return realFetch(input, init);
      if (url.includes("/file/bot"))
        return new Response(receipt, { headers: { "content-type": "image/jpeg" } });
      const method = url.split("/").pop()!;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      tg.push([method, body]);
      if (method === "setWebhook") webhookUrlAtTelegram = body.url;
      const result =
        method === "getMe"
          ? { id: 123456, username: "demo_rehearsal_bot" }
          : method === "getWebhookInfo"
            ? { url: webhookUrlAtTelegram, pending_update_count: 0 }
            : method === "getFile"
              ? { file_path: "photos/receipt.jpg" }
              : { message_id: tg.length };
      return new Response(JSON.stringify({ ok: true, result }), {
        headers: { "content-type": "application/json" },
      });
    });

    // Клиент «как на v1»: токена в базе нет (он в проекте Vercel клиента), чата продавца нет.
    // Связь с другим магазином оператор поставил заранее — как у VIP-клиента с двумя ботами.
    const settings: Record<string, unknown> = {
      ...(saved.settings as Record<string, unknown>),
      served_by: "v1",
      multi_bot: { group: GROUP },
      // Аккаунт Zernio для проверки переезда: у «Демо-тестера» бывают заказы из
      // Instagram, а без аккаунта проверка блокирует переезд (preflight, #238).
      zernio: { account_ids: ["acc-demo-migration-test"] },
    };
    delete settings.telegram;
    await db
      .from("bots")
      // Владелец из карточки тоже подтверждает заказы — на время «нет продавца» его нет.
      .update({ bot_token: null, settings: settings as Json, owner_telegram_id: null })
      .eq("id", DEMO_BOT);
    await db
      .from("app_settings")
      .upsert({ bot_id: DEMO_BOT, key: "admin_chat_id", value: "" }, { onConflict: "bot_id,key" });
    // Покупатель, пришедший при v1: баллы и незаконченный диалог.
    await db.from("bot_users").insert({
      bot_id: DEMO_BOT,
      user_key: `tg_${LOYAL}`,
      telegram_id: LOYAL,
      platform: "telegram",
      first_name: "Постоянный покупатель",
      loyalty_points: LOYAL_POINTS,
      state: { mode: "browsing" },
    });
    invalidateTenantDirectory();
    v1Snapshot = await snapshot();
    console.log("[rehearsal] до переезда:", JSON.stringify(v1Snapshot));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    const db = serviceDb();
    if (saved) await db.from("bots").update(saved).eq("id", DEMO_BOT);
    if (prevAdmins)
      await db
        .from("app_settings")
        .update(prevAdmins)
        .eq("bot_id", DEMO_BOT)
        .eq("key", "admin_chat_id");
    else await db.from("app_settings").delete().eq("bot_id", DEMO_BOT).eq("key", "admin_chat_id");
    await cleanup();
    invalidateTenantDirectory();
  });

  it("пока клиент на v1, ни один крон v2 его не видит", async () => {
    // Тот же отбор, что в /api/cron/<job> (кроны), runRetention и sweepSubscriptions.
    const dir = await tenantDirectory(true);
    const cronTenants = dir.filter(servedByV2).map((t) => t.id);
    expect(cronTenants).not.toContain(DEMO_BOT);
    // Клиенты прежней платформы (только чтение) — тоже мимо.
    const v1 = dir.filter((t) => !servedByV2(t));
    for (const t of v1) expect(cronTenants).not.toContain(t.id);
    console.log(`[rehearsal] кроны видят ${cronTenants.length}, клиентов v1 мимо: ${v1.length}`);
  });

  it("за день до переезда: проверка называет, чего не хватает", async () => {
    const p = await preflight(DEMO_BOT);
    expect(p.ready).toBe(false);
    console.log("[rehearsal] блокирует:", preflightBlockers(p));
    expect(preflightBlockers(p)).toContain("Некому подтверждать заказы");
  });

  it("onboard без чата продавца — 409, клиент остаётся на v1", async () => {
    const r = await onboard({ bot_id: DEMO_BOT, telegram_token: TOKEN, served_by: "v2" });
    console.log("[rehearsal] onboard без продавца:", r.status, r.json?.error);
    expect(r.status).toBe(409);
    invalidateTenantDirectory();
    expect((await requireTenant({ by: "id", value: DEMO_BOT })).settings.served_by).toBe("v1");
  });

  it("оператор заводит продавца, реквизиты и товар; onboard переводит на v2 и ставит вебхук", async () => {
    const db = serviceDb();
    await db
      .from("app_settings")
      .update({ value: String(SELLER) })
      .eq("bot_id", DEMO_BOT)
      .eq("key", "admin_chat_id");
    await db.storage
      .from("product-files")
      .upload(
        FILE_PATH,
        new Blob([Buffer.from("%PDF-1.4 rehearsal\n")], { type: "application/pdf" }),
        {
          upsert: true,
        },
      );
    const { data: p } = await db
      .from("products")
      .insert({
        bot_id: DEMO_BOT,
        name: PROBE,
        description: "репетиция",
        price: 700,
        currency: "KZT",
        is_active: true,
        fulfillment_kind: "digital",
        category_ids: [],
        country_prices: {},
      })
      .select("id")
      .single();
    productId = p!.id;
    await db.from("product_material_files").insert({
      bot_id: DEMO_BOT,
      product_id: productId,
      language: "ru",
      file_path: FILE_PATH,
      file_name: "material.pdf",
      sort_order: 0,
    });
    await db.from("payment_methods").insert({
      bot_id: DEMO_BOT,
      country_code: "KZ",
      country_name: COUNTRY,
      instructions: "Kaspi: реквизиты репетиции",
      currency: "KZT",
      is_active: true,
      sort_order: -1,
    });
    invalidateTenantDirectory();
    const pf = await preflight(DEMO_BOT);
    console.log(
      "[rehearsal] перед переключением:",
      preflightBlockers(pf),
      pf.checks.filter((c) => c.level === "warn").map((c) => c.title),
    );

    tg.length = 0;
    const r = await onboard({ bot_id: DEMO_BOT, telegram_token: TOKEN, served_by: "v2" });
    console.log("[rehearsal] onboard:", r.status, JSON.stringify(r.json));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ served_by: "v2", webhook: { ok: true } });
    expect(webhookUrlAtTelegram).toBe(telegramWebhookUrl(env().APP_URL, DEMO_BOT));
    expect(tg.some(([m]) => m === "setChatMenuButton")).toBe(true);
    const state = await webhookState(DEMO_BOT);
    expect(state).toMatchObject({ ok: true, pending: 0 });
  });

  it("после переезда ничего не потерялось: модули, тариф, связь ботов, покупатели и баллы", async () => {
    const after = await snapshot();
    expect(after).toEqual(v1Snapshot);
    // v2 видит тех же покупателей под ключом арендатора (RLS), без обрезки на 1000.
    expect(await customersFingerprint("v2")).toBe(v1Snapshot!.customers);
    const t = await tenant();
    expect(servedByV2(t)).toBe(true);
    const loyal = await getCustomerByTelegramId(tenantContext(t), LOYAL);
    expect(loyal?.loyaltyPoints).toBe(LOYAL_POINTS);
    expect(loyal?.state).toMatchObject({ mode: "browsing" });
    // Теперь клиент в кронах v2.
    expect((await tenantDirectory(true)).filter(servedByV2).map((x) => x.id)).toContain(DEMO_BOT);
  });

  it("любой план, назначенный после переезда, сохраняет всё включённое сверх плана", async () => {
    // Только расчёт, без записи: назначение плана — setPlan в tests/integration/plans.test.ts.
    const t = await tenant();
    const niche = nicheForVertical(t.vertical);
    if (!niche) return;
    const on = (Object.keys(t.modules) as ModuleKey[]).filter(
      (k) => t.modules[k] && moduleDef(k).status === "available",
    );
    // Клиент v1 приходит без плана v2: первое назначение (как «Перевести на
    // подобранный план») переносит всё включённое вне плана в сохранённые.
    const grandfathered = keptModules(null, undefined, t.modules);
    for (const tier of PLAN_TIERS) {
      const mods = effectiveModules(parsePlan(`${niche}.${tier}`), { grandfathered })!;
      expect(
        on.filter((k) => !mods[k]),
        `${niche}.${tier}`,
      ).toEqual([]);
    }
  });

  // Полный путь заказа — десяток обращений к живой базе по 2–4 с каждое.
  it("покупатель проходит заказ через вебхук, продавец подтверждает, файл уходит", async () => {
    expect((await webhook(msg({ text: "/start" }))).status).toBe(200);
    await webhook(press(`prod:${productId}`));
    const setCountry = button(/^setcountry:KZ/);
    if (setCountry) {
      await webhook(press(setCountry));
      await webhook(press(`prod:${productId}`));
    }
    const add = button(new RegExp(`^add:${productId}`));
    expect(add).not.toBeNull();
    await webhook(press(add!));
    await webhook(press("checkout"));
    await webhook(msg({ contact: { phone_number: "+77001234567" } }));
    const country = button(/^country:KZ/);
    if (country) await webhook(press(country));
    const pay = button(/^pay:manual:/);
    if (pay) await webhook(press(pay));
    const order = await orderStatus();
    expect(order?.status).toBe("awaiting_payment");

    await webhook(msg({ photo: [{ file_id: "receipt" }] }));
    await waitFor(async () => (await orderStatus())?.status === "awaiting_confirmation");
    expect((await orderStatus())?.status).toBe("awaiting_confirmation");
    // Уведомление продавцу уходит в фоне сразу после смены статуса.
    const confirmRe = new RegExp(`^confirm:${order!.id}$`);
    await waitFor(async () => button(confirmRe, SELLER) !== null);
    const confirm = button(confirmRe, SELLER);
    expect(confirm, "продавцу не пришла кнопка подтверждения").not.toBeNull();

    await webhook(press(confirm!, SELLER));
    await waitFor(async () =>
      tg.some(([m, p]) => m === "sendDocument" && String(p.chat_id) === String(TG)),
    );
    await waitFor(async () => (await orderStatus())?.status === "delivered");
    expect((await orderStatus())?.status).toBe("delivered");
    expect(tg.some(([m, p]) => m === "sendDocument" && String(p.chat_id) === String(TG))).toBe(
      true,
    );
  }, 120_000);

  it("откат: onboard {served_by: v1} — кнопка меню стандартная, вебхук v2 отвечает 503", async () => {
    tg.length = 0;
    const r = await onboard({ bot_id: DEMO_BOT, served_by: "v1" });
    console.log("[rehearsal] откат:", r.status, JSON.stringify(r.json));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ served_by: "v1", webhook: null });
    expect(tg).toContainEqual(["setChatMenuButton", { menu_button: { type: "default" } }]);
    expect(tg.some(([m]) => m === "setWebhook" || m === "deleteWebhook")).toBe(false);
    invalidateTenantDirectory();
    expect((await webhook(msg({ text: "/start" }))).status).toBe(503);
    // Откат тоже ничего не теряет, и кроны снова мимо клиента.
    const back = await snapshot();
    // Покупатель репетиции оформил заказ — его строка в bot_users могла обновиться,
    // но не пропасть; сверяем всё, кроме покупателей, и отдельно баллы постоянного.
    expect({ ...back, customers: null }).toEqual({ ...v1Snapshot, customers: null });
    const loyal = await getCustomerByTelegramId(tenantContext(await tenant()), LOYAL);
    expect(loyal?.loyaltyPoints).toBe(LOYAL_POINTS);
    expect((await tenantDirectory(true)).filter(servedByV2).map((x) => x.id)).not.toContain(
      DEMO_BOT,
    );
  });
});
