import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb, type FakeDb } from "../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ParsedZernioMessage } from "@/channels/zernio/message";
import type { ZernioTransport } from "@/channels/zernio/api.server";
import type { TelegramApi } from "@/channels/telegram/api";
import { handleTelegramUpdate } from "@/channels/telegram/handle-update";
import { handleShopMessage } from "@/channels/zernio/shop.server";
import { checkLoginCode, newLoginNonce } from "@/core/storefront/code-login";
import { COPY } from "@/channels/telegram/copy";
import { env } from "@/config/env";

/** В5: бот присылает код входа на витрину по метке браузера — в Telegram и в Direct/WhatsApp. */
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({ storage: { from: () => ({}) } }),
}));

const BOT = "bot-1";
beforeEach(() => setEnvForTests({}));
afterEach(() => setEnvForTests(undefined));

function tenantDb(opts: { open?: boolean; servedBy?: string } = {}) {
  const db: FakeDb = fakeDb({ rpc: { manager_chat_touch: () => {} } });
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: "storefront_checkout",
      value: JSON.stringify({ enabled: opts.open ?? true, tgLogin: true }),
    },
  ];
  db.tables.products = [];
  db.tables.categories = [];
  db.tables.cart_items = [];
  db.tables.orders = [];
  const ctx = {
    tenant: {
      id: BOT,
      name: "Магазин",
      status: "active",
      vertical: "digital",
      archived: false,
      modules: { shop: true, web_storefront: true },
      settings: { default_locale: "ru", served_by: opts.servedBy ?? "v2" },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { db, ctx };
}

function telegram(opts: Parameters<typeof tenantDb>[0] = {}) {
  const { db, ctx } = tenantDb(opts);
  db.tables.bot_users = [
    {
      id: "u1",
      bot_id: BOT,
      user_key: "tg_42",
      platform: "telegram",
      telegram_id: 42,
      opt_out: false,
      state: { locale: "ru" },
    },
  ];
  const sent: string[] = [];
  const api = {
    call: vi.fn(async (m: string, p: Record<string, unknown> = {}) => {
      if (m === "sendMessage") sent.push(String(p.text));
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  let id = 0;
  const start = (payload: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: ++id,
      message: {
        message_id: id,
        date: 0,
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false, first_name: "Анна" },
        text: `/start ${payload}`,
      },
    } as never);
  return { db, ctx, sent, start };
}

const codeIn = (t: string) => /<b>(\d{6})<\/b>/.exec(t)?.[1];

describe("код входа на витрину в Telegram: /start lg_<метка>", () => {
  it("бот присылает код; он подходит к метке один раз, в базе кода нет", async () => {
    const t = telegram();
    const nonce = newLoginNonce();
    await t.start(`lg_${nonce}`);
    expect(t.sent).toHaveLength(1);
    const code = codeIn(t.sent[0]!)!;
    expect(code).toBeTruthy();
    expect(JSON.stringify(t.db.tables.bot_users)).not.toContain(code);
    expect(JSON.stringify(t.db.tables.bot_users)).not.toContain(nonce);
    // метка не попала в «откуда пришёл покупатель»
    expect(
      (t.db.tables.bot_users![0]!.state as { first_source?: string }).first_source,
    ).toBeUndefined();
    const secret = env().SESSION_SECRET;
    expect(await checkLoginCode(t.ctx, secret, nonce, code)).toEqual({ ok: true, telegramId: 42 });
    expect(await checkLoginCode(t.ctx, secret, nonce, code)).toMatchObject({
      ok: false,
      reason: "used",
    });
  });

  it("повторный запрос сразу — «подождите», нового кода нет", async () => {
    const t = telegram();
    const nonce = newLoginNonce();
    await t.start(`lg_${nonce}`);
    await t.start(`lg_${nonce}`);
    expect(t.sent).toHaveLength(2);
    expect(codeIn(t.sent[1]!)).toBeUndefined();
    expect(t.sent[1]).toBe(COPY.ru.loginCodeWait);
  });

  it("вход на витрине выключен или клиент ещё на прежней платформе — кода нет", async () => {
    for (const o of [{ open: false }, { servedBy: "v1" }]) {
      const t = telegram(o);
      await t.start(`lg_${newLoginNonce()}`);
      expect(t.sent.map(codeIn)).toEqual([undefined]);
      expect(t.sent).toEqual([COPY.ru.loginCodeBad]);
    }
  });

  it("битая метка — обычный /start без кода", async () => {
    const t = telegram();
    await t.start("lg_коротко");
    expect(t.sent.some((x) => codeIn(x))).toBe(false);
  });
});

function direct(platform: "whatsapp" | "instagram", opts: Parameters<typeof tenantDb>[0] = {}) {
  const { db, ctx } = tenantDb(opts);
  const state = { locale: "ru" };
  db.tables.bot_users = [
    {
      id: "u1",
      bot_id: BOT,
      user_key: "wa_1",
      platform,
      telegram_id: -1,
      loyalty_points: 0,
      state,
    },
  ];
  const sent: string[] = [];
  const transport = {
    send: vi.fn(async (_c: string, _a: string, text: string) => {
      sent.push(text);
      return { ok: true };
    }),
    tail: vi.fn(async () => []),
    download: vi.fn(async () => null),
    mailReady: () => false,
  } as unknown as ZernioTransport;
  const customer = {
    userKey: "wa_1",
    platform,
    telegramId: -1,
    firstName: "Мария",
    loyaltyPoints: 0,
    state,
  } as unknown as Customer;
  const say = (text: string) => {
    customer.state = db.tables.bot_users![0]!.state as Customer["state"];
    return handleShopMessage(
      ctx,
      customer,
      {
        conversationId: "c1",
        accountId: "a1",
        platform,
        senderId: "1",
        text,
        postbackPayload: null,
        nativeOrder: null,
        attachments: [],
        mediaWithoutUrl: false,
      } as unknown as ParsedZernioMessage,
      transport,
    );
  };
  return { db, ctx, sent, say };
}

describe("код входа на витрину в Direct/WhatsApp: «вход <метка>»", () => {
  for (const platform of ["whatsapp", "instagram"] as const)
    it(`${platform}: покупатель, с которым бот ещё не говорил, получает код; он открывает его вход`, async () => {
      const t = direct(platform);
      const nonce = newLoginNonce();
      const r = await t.say(`вход ${nonce}`);
      expect(r.outcome).toBe("handled");
      expect(t.sent).toHaveLength(1);
      const code = /(\d{6})/.exec(t.sent[0]!)![1]!;
      expect(t.sent[0]).not.toContain("<b>");
      expect(await checkLoginCode(t.ctx, env().SESSION_SECRET, nonce, code)).toEqual({
        ok: true,
        telegramId: -1,
      });
    });

  it("вход выключен — «ссылка устарела», кода нет", async () => {
    const t = direct("whatsapp", { open: false });
    await t.say(`вход ${newLoginNonce()}`);
    expect(t.sent).toEqual([COPY.ru.loginCodeBad]);
  });

  it("обычное «вход» без метки — не наша команда: незнакомому молчим", async () => {
    const t = direct("whatsapp");
    await t.say("вход");
    expect(t.sent).toEqual([]);
  });
});
