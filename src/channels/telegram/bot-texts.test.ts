import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import type { Tenant } from "@/core/tenant/types";
import { handleTelegramUpdate } from "./handle-update";
import { notUnderstoodHtml, offHoursHtml, orderThanksHtml, welcomeHtml } from "./screens";
import { COPY } from "./copy";
import { STANDARD } from "@/core/bot-texts/registry";
import type { TelegramApi } from "./api";

/** Б8: свои тексты бота доходят до покупателя в Telegram, стандартные работают как раньше. */
const TG = 42;

const tenantWith = (settings: Record<string, unknown>) =>
  ({ id: "bot-1", name: "Лавка", vertical: "digital", modules: {}, settings }) as unknown as Tenant;

function bot(settings: Record<string, unknown>, initial: Record<string, unknown> = {}) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      opt_out: false,
      state: { locale: "ru", ...initial },
    },
  ];
  db.tables.products = [];
  db.tables.categories = [];
  const ctx = {
    tenant: { ...tenantWith(settings), status: "active" },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const sent: string[] = [];
  const api = {
    call: vi.fn(async (method: string, p: Record<string, unknown> = {}) => {
      if (method === "sendMessage") sent.push(String(p.text));
      return { ok: true, result: { message_id: 1 } };
    }),
  } as unknown as TelegramApi;
  const say = (text: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: TG, type: "private" },
        from: { id: TG, is_bot: false, first_name: "A" },
        text,
      },
    } as never);
  const state = () => db.tables.bot_users![0]!.state as Record<string, unknown>;
  return { say, sent, state };
}

beforeEach(() => setEnvForTests({}));
afterEach(() => {
  setEnvForTests(undefined);
  vi.useRealTimers();
});

describe("тексты, которые видит покупатель", () => {
  const custom = {
    bot_texts: {
      welcome: { telegram: { ru: "Привет, <b>{shop}</b>!" } },
      not_understood: { telegram: { ru: "Напишите слово или нажмите кнопку" } },
      order_thanks: { telegram: { ru: "Спасибо за №{order}" } },
      off_hours: { telegram: { ru: "Мы спим до {from}" } },
    },
  };

  it("приветствие: свой текст экранируется и получает название магазина; без своего — прежнее", () => {
    expect(welcomeHtml(tenantWith(custom), "Лавка", "ru")).toBe(
      "Привет, &lt;b&gt;Лавка&lt;/b&gt;!",
    );
    expect(welcomeHtml(tenantWith({}), "Лавка", "ru")).toContain("<b>Лавка</b>");
    // другой язык своего текста не имеет — стандартный
    expect(welcomeHtml(tenantWith(custom), "Лавка", "en")).toContain("<b>Лавка</b>");
  });

  it("«не понял»: свой текст или стандартная подсказка на каждом языке", () => {
    expect(notUnderstoodHtml(tenantWith(custom), "ru")).toBe("Напишите слово или нажмите кнопку");
    for (const l of ["ru", "kk", "en", "uz"] as const)
      expect(notUnderstoodHtml(tenantWith({}), l)).toBe(COPY[l].useMenu);
  });

  it("«спасибо за заказ»: без своего текста не отправляется, со своим — с номером", () => {
    expect(orderThanksHtml(tenantWith({}), "ru", 15)).toBeNull();
    expect(orderThanksHtml(tenantWith(custom), "ru", 15)).toBe("Спасибо за №15");
  });

  it("«вне часов»: стандартный на четырёх языках с часами, свой — со своими", () => {
    const hours = { open: 9, close: 18 };
    for (const l of ["ru", "kk", "en", "uz"] as const) {
      const t = offHoursHtml(tenantWith({}), l, hours);
      expect(t).toContain("09:00");
      expect(t).toContain("18:00");
      expect(t).toBe(STANDARD.off_hours![l].replace("{from}", "09:00").replace("{to}", "18:00"));
    }
    expect(offHoursHtml(tenantWith(custom), "ru", hours)).toBe("Мы спим до 09:00");
  });
});

describe("бот: вне часов работы и «не понял»", () => {
  const hours = { work_hours: { open: 10, close: 21 } };
  // 02:00 по Алматы — вне часов, 14:05 — внутри
  const NIGHT = "2026-10-03T21:00:00Z";
  const DAY = "2026-10-04T09:05:00Z";

  it("ночью на реплику — ответ «вне часов» один раз в 6 часов, затем обычная работа", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NIGHT));
    const b = bot({
      ...hours,
      bot_texts: { off_hours: { telegram: { ru: "Мы спим до {from}" } } },
    });
    await b.say("привет всем");
    expect(b.sent[0]).toBe("Мы спим до 10:00");
    expect(typeof b.state().off_hours_at).toBe("string");
    const count = b.sent.length;
    await b.say("ещё вопрос");
    expect(b.sent.slice(count)).not.toContain("Мы спим до 10:00");
    vi.setSystemTime(new Date("2026-10-04T04:30:00Z")); // через 7,5 часа, всё ещё до 10:00 по Алматы
    await b.say("и ещё");
    expect(b.sent.filter((s) => s === "Мы спим до 10:00")).toHaveLength(2);
  });

  it("днём и без заданных часов «вне часов» молчит", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(DAY));
    const day = bot(hours);
    await day.say("привет всем");
    expect(day.sent.join("\n")).not.toContain("не на связи");
    expect(day.state().off_hours_at).toBeUndefined();
    vi.setSystemTime(new Date(NIGHT));
    const noHours = bot({});
    await noHours.say("привет всем");
    expect(noHours.state().off_hours_at).toBeUndefined();
  });
});
