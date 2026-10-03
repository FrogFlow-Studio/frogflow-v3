import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { userKey } from "@/core/customers/customers";
import { referralStats } from "@/core/referrals/referrals";
import { handleTelegramUpdate } from "./handle-update";
import { mainMenu } from "./screens";
import { menuActionFor, COPY } from "./copy";
import { botCommandFor, botCommandList } from "./commands";
import type { TelegramApi } from "./api";

/** «Пригласить друга»: пункт меню, команда /invite и сводка по таблице referrals. */
const TG = 42;
const BOT = "bot-1";

function setup(modules: Record<string, boolean>, locale = "ru") {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      state: { locale },
    },
  ];
  const ctx = {
    tenant: {
      id: BOT,
      status: "active",
      vertical: "digital",
      modules,
      settings: { default_locale: "ru", telegram: { username: "shop_bot" } },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  return { ctx, db, api, calls };
}

const say = (text: string) =>
  ({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: TG, type: "private" },
      from: { id: TG, is_bot: false, first_name: "A" },
      text,
    },
  }) as never;

function seedReferrals(db: FakeDb) {
  db.tables.referrals = [
    {
      id: "r1",
      bot_id: BOT,
      referrer_telegram_id: TG,
      referred_telegram_id: 1,
      status: "rewarded",
      reward_promo_code: "REF-AAA",
    },
    {
      id: "r2",
      bot_id: BOT,
      referrer_telegram_id: TG,
      referred_telegram_id: 2,
      status: "pending",
      reward_promo_code: null,
    },
    {
      id: "r3",
      bot_id: BOT,
      referrer_telegram_id: TG,
      referred_telegram_id: 3,
      status: "rewarded",
      reward_promo_code: "REF-BBB",
    },
    {
      id: "r4",
      bot_id: BOT,
      referrer_telegram_id: 777,
      referred_telegram_id: 4,
      status: "rewarded",
      reward_promo_code: "REF-CCC",
    },
  ];
  db.tables.promo_codes = [
    { id: "p1", bot_id: BOT, code: "REF-AAA", used_count: 1, max_uses: 1 },
    { id: "p2", bot_id: BOT, code: "REF-BBB", used_count: 0, max_uses: 1 },
  ];
}

describe("пункт меню и команда /invite", () => {
  const tenant = (modules: Record<string, boolean>) =>
    ({ vertical: "digital", modules, settings: {} }) as unknown as Tenant;
  const labels = (modules: Record<string, boolean>) =>
    mainMenu(tenant(modules), "ru", "https://app.test")
      .keyboard.flat()
      .map((b) => b.text);

  it("пункт есть при модуле referral и без «Юр. документов», без referral — нет", () => {
    expect(labels({ referral: true })).toContain(COPY.ru.inviteFriendBtn);
    expect(labels({ referral: true, legal_docs: false })).toContain(COPY.ru.inviteFriendBtn);
    expect(labels({ legal_docs: true })).not.toContain(COPY.ru.inviteFriendBtn);
  });

  it("кнопка распознаётся на 4 языках, /invite — только при referral", () => {
    for (const l of ["ru", "kk", "en", "uz"] as const)
      expect(menuActionFor(COPY[l].inviteFriendBtn, [])).toBe("invite");
    expect(botCommandFor("/invite")).toBe("invite");
    expect(botCommandList(tenant({ referral: true }), "ru").map((c) => c.command)).toContain(
      "invite",
    );
    expect(botCommandList(tenant({}), "ru").map((c) => c.command)).not.toContain("invite");
  });
});

describe("экран «Пригласить друга»", () => {
  it("ссылка, счётчики по таблице referrals и коды с отметкой «использован»", async () => {
    const { ctx, db, api, calls } = setup({ referral: true });
    seedReferrals(db);
    await handleTelegramUpdate(ctx, api, say("/invite"));
    const sent = calls.filter(([m]) => m === "sendMessage").pop()![1];
    const text = String(sent.text);
    expect(text).toContain(`https://t.me/shop_bot?start=ref_${TG}`);
    expect(text).toContain("Пришло друзей: <b>3</b>");
    expect(text).toContain("Купили: <b>2</b>");
    expect(text).toContain("<code>REF-AAA</code> — использован");
    expect(text).toContain("<code>REF-BBB</code>");
    expect(text).not.toContain("REF-BBB</code> —");
    expect(text).not.toContain("REF-CCC");
  });

  it("без модуля referral команда ведёт в главное меню, а не на экран", async () => {
    const { ctx, api, calls } = setup({ referral: false });
    await handleTelegramUpdate(ctx, api, say("/invite"));
    expect(calls.some(([, p]) => String(p.text).includes("Пришло друзей"))).toBe(false);
  });

  it("ошибка чтения — отказ, а не «0 друзей»", async () => {
    const { ctx, db, api, calls } = setup({ referral: true });
    const broken: unknown = new Proxy(() => undefined, {
      get: (_t, prop) =>
        prop === "then"
          ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } })
          : () => broken,
    });
    ctx.db = new Proxy(db, {
      get: (t, prop, r) =>
        prop === "from"
          ? (name: string) => (name === "referrals" ? broken : t.from(name))
          : Reflect.get(t, prop, r),
    }) as never;
    await expect(referralStats(ctx, TG)).rejects.toThrow(/referral/);
    await handleTelegramUpdate(ctx, api, say("/invite")).catch(() => undefined);
    expect(calls.some(([, p]) => String(p.text).includes("Пришло друзей"))).toBe(false);
  });

  it("экран и кнопка есть на kk, en, uz", async () => {
    for (const [l, word] of [
      ["kk", "Келген достар"],
      ["en", "Friends joined"],
      ["uz", "Kelgan do‘stlar"],
    ] as const) {
      const { ctx, db, api, calls } = setup({ referral: true }, l);
      seedReferrals(db);
      await handleTelegramUpdate(ctx, api, say("/invite"));
      const text = String(calls.filter(([m]) => m === "sendMessage").pop()![1].text);
      expect(text).toContain(word);
    }
  });
});

describe("«Информация» на языке покупателя", () => {
  it("ссылки на документы подписаны на kk, en, uz, а не по-русски", async () => {
    for (const l of ["kk", "en", "uz"] as const) {
      const { ctx, api, calls } = setup({ legal_docs: true }, l);
      await handleTelegramUpdate(ctx, api, say(COPY[l].information));
      const kb = calls.filter(([m]) => m === "sendMessage").pop()![1].reply_markup as {
        inline_keyboard: Array<Array<{ text: string }>>;
      };
      const labels = kb.inline_keyboard.flat().map((b) => b.text);
      expect(labels).toEqual(
        expect.arrayContaining([
          COPY[l].infoOfferBtn,
          COPY[l].infoPrivacyBtn,
          COPY[l].infoRequisitesBtn,
          COPY[l].infoAboutBtn,
        ]),
      );
      // «Оферта» по-казахски пишется так же; остальные подписи у kk отличаются.
      expect(labels).not.toContain("🔒 Конфиденциальность");
      if (l !== "kk") expect(labels).not.toContain("📄 Оферта");
    }
  });
});
