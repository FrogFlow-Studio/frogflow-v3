import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";
import { invalidateTenantDirectory, requireTenant } from "@/core/tenant/resolve.server";
import { encryptSecret } from "@/core/secrets/vault";
import { telegramWebhookSecret, telegramWebhookUrl } from "@/channels/telegram/secret";
import { setServedBy } from "@/app/operator/operator.server";
import { preflight } from "@/app/operator/migration.server";
import { preflightBlockers } from "@/core/tenant/preflight";
import { Route } from "@/routes/api/telegram.$botId";

/**
 * Переезд и откат по docs/MIGRATION.md на демо-клиенте: предполётная проверка
 * блокирует без продавца, переключатель ставит вебхук на v2 с подписью,
 * откат возвращает кнопку меню, и вебхук v2 отвечает 503 — Telegram держит
 * обновления для v1. Telegram подменён (у демо нет своего бота), база настоящая;
 * строка bots демо-клиента восстанавливается как была.
 */
const ACTOR = "v2-live-migration-test";
const COUNTRY = "Казахстан (v2 live migration)";
const FAKE_TOKEN = "123456:v2-live-migration-fake";

let saved: {
  bot_token: string | null;
  settings: Json;
  owner_telegram_id: number | null;
} | null = null;
let prevAdmins: { value: string } | null = null;
const tg: Array<[string, Record<string, unknown>]> = [];
const realFetch = globalThis.fetch;

async function restore() {
  const db = serviceDb();
  if (saved) await db.from("bots").update(saved).eq("id", DEMO_BOT);
  if (prevAdmins)
    await db
      .from("app_settings")
      .update(prevAdmins)
      .eq("bot_id", DEMO_BOT)
      .eq("key", "admin_chat_id");
  await db.from("payment_methods").delete().eq("bot_id", DEMO_BOT).eq("country_name", COUNTRY);
  await db.from("bot_events").delete().eq("bot_id", DEMO_BOT).eq("actor", ACTOR);
  invalidateTenantDirectory();
}

async function webhookPost(withSecret = true) {
  const post = (
    Route.options as unknown as {
      server: {
        handlers: {
          POST: (a: { request: Request; params: { botId: string } }) => Promise<Response>;
        };
      };
    }
  ).server.handlers.POST;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withSecret)
    headers["x-telegram-bot-api-secret-token"] = telegramWebhookSecret(
      DEMO_BOT,
      env().WEBHOOK_SECRET,
    );
  return post({
    request: new Request(`https://x/api/telegram/${DEMO_BOT}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ update_id: Date.now() }),
    }),
    params: { botId: DEMO_BOT },
  });
}

describe.skipIf(!liveReady)("переезд и откат на демо-клиенте", () => {
  beforeAll(async () => {
    const db = serviceDb();
    const { data, error } = await db
      .from("bots")
      .select("bot_token, settings, owner_telegram_id")
      .eq("id", DEMO_BOT)
      .single();
    if (error || !data) throw new Error(`demo bot: ${error?.message}`);
    saved = {
      bot_token: data.bot_token,
      settings: data.settings,
      owner_telegram_id: data.owner_telegram_id,
    };
    const { data: admins } = await db
      .from("app_settings")
      .select("value")
      .eq("bot_id", DEMO_BOT)
      .eq("key", "admin_chat_id")
      .maybeSingle();
    prevAdmins = admins ? { value: admins.value ?? "" } : null;

    // Telegram — подмена; всё остальное (Supabase) идёт в сеть как есть.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith(env().TELEGRAM_API_BASE)) {
        const method = url.split("/").pop()!;
        tg.push([method, init?.body ? JSON.parse(String(init.body)) : {}]);
        const result =
          method === "getMe"
            ? { id: 123456, username: "demo_v2_live_bot" }
            : method === "getWebhookInfo"
              ? { url: "https://v1.example/api/telegram", pending_update_count: 0 }
              : true;
        return new Response(JSON.stringify({ ok: true, result }), {
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input, init);
    });

    // Клиент «на v1» с токеном и реквизитами, но пока без чата продавца.
    const settings = {
      ...(saved.settings as Record<string, unknown>),
      served_by: "v1",
      // Аккаунт Zernio для проверки переезда: у «Демо-тестера» бывают заказы из
      // Instagram, а без аккаунта проверка блокирует переезд (preflight, #238).
      zernio: { account_ids: ["acc-demo-migration-test"] },
    };
    await db
      .from("bots")
      // Владелец из карточки тоже подтверждает заказы — на время «нет продавца» его нет.
      .update({
        bot_token: encryptSecret(FAKE_TOKEN, env().SECRETS_KEY),
        settings,
        owner_telegram_id: null,
      })
      .eq("id", DEMO_BOT);
    await db
      .from("app_settings")
      .upsert({ bot_id: DEMO_BOT, key: "admin_chat_id", value: "" }, { onConflict: "bot_id,key" });
    const { error: mErr } = await db.from("payment_methods").insert({
      bot_id: DEMO_BOT,
      country_code: "KZ",
      country_name: COUNTRY,
      instructions: "тестовые реквизиты",
      currency: "KZT",
      is_active: true,
      sort_order: 0,
    });
    if (mErr) throw new Error(`seed payment method: ${mErr.message}`);
    invalidateTenantDirectory();
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await restore();
  });

  it("без чата продавца переезд заблокирован, клиент остаётся на v1", async () => {
    const p = await preflight(DEMO_BOT);
    expect(p.ready).toBe(false);
    expect(preflightBlockers(p)).toEqual(["Некому подтверждать заказы"]);
    await expect(setServedBy(DEMO_BOT, "v2", ACTOR)).rejects.toThrow(/нельзя перевести/);
    invalidateTenantDirectory();
    expect((await requireTenant({ by: "id", value: DEMO_BOT })).settings.served_by).toBe("v1");
    expect(tg.some(([m]) => m === "setWebhook")).toBe(false);
  });

  it("вебхук клиента на v1 отвечает 503, без подписи — 403", async () => {
    expect((await webhookPost()).status).toBe(503);
    expect((await webhookPost(false)).status).toBe(403);
  });

  it("переезд: проверка пройдена, вебхук на v2 с подписью, served_by = v2", async () => {
    await serviceDb()
      .from("app_settings")
      .update({ value: "990000070" })
      .eq("bot_id", DEMO_BOT)
      .eq("key", "admin_chat_id");
    const p = await preflight(DEMO_BOT);
    expect(preflightBlockers(p)).toEqual([]);
    tg.length = 0;
    const r = await setServedBy(DEMO_BOT, "v2", ACTOR);
    expect(r).toMatchObject({ ok: true });
    const set = tg.find(([m]) => m === "setWebhook")?.[1];
    expect(set).toMatchObject({
      url: telegramWebhookUrl(env().APP_URL, DEMO_BOT),
      secret_token: telegramWebhookSecret(DEMO_BOT, env().WEBHOOK_SECRET),
      drop_pending_updates: false,
    });
    expect(tg.some(([m]) => m === "setChatMenuButton")).toBe(true);
    invalidateTenantDirectory();
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    expect(t.settings.served_by).toBe("v2");
    // Дата переезда — по ней «Обзор» показывает карточку переехавшему продавцу.
    expect(Date.parse(t.settings.served_by_since ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect(t.settings.telegram?.webhook_ok).toBe(true);
  });

  it("откат: served_by = v1, кнопка меню стандартная, вебхук v2 снова 503", async () => {
    tg.length = 0;
    await setServedBy(DEMO_BOT, "v1", ACTOR);
    expect(tg).toContainEqual(["setChatMenuButton", { menu_button: { type: "default" } }]);
    // Вебхук не трогаем: его забирает крон деплоя v1.
    expect(tg.some(([m]) => m === "setWebhook" || m === "deleteWebhook")).toBe(false);
    invalidateTenantDirectory();
    expect((await requireTenant({ by: "id", value: DEMO_BOT })).settings.served_by).toBe("v1");
    expect((await webhookPost()).status).toBe(503);
  });
});
