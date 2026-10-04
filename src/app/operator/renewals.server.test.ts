import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { Tenant } from "@/core/tenant/types";

/** Воронка продлений: каждое напоминание один раз, оплатил — серия стоит, v1 не трогаем. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/config/env", () => ({ env: () => ({ APP_TIMEZONE: "Asia/Almaty" }) }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantContext: (t: Tenant) => ({ db, tenant: t, timezone: "Asia/Almaty" }),
  tenantDirectory: async () => [],
}));
vi.mock("./operator.server", () => ({ notifyOwner: async () => ({ delivered: [], failed: [] }) }));

const { runRenewals, renewalText } = await import("./renewals.server");
const { adminT } = await import("@/app/i18n/admin");
type Deps = NonNullable<Parameters<typeof runRenewals>[2]>;

const BOT = "00000000-0000-0000-0000-0000000000c1";
const EXPIRES = "2026-10-08";
// 11:00 в Алматы: день D октября.
const at = (d: number) => new Date(`2026-10-${String(d).padStart(2, "0")}T06:00:00Z`);

const tenant = (over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) =>
  ({
    id: BOT,
    name: "Демо",
    status: "active",
    archived: false,
    plan: "digital.pro",
    settings: { served_by: "v2", ...settings },
    ...over,
  }) as unknown as Tenant;

let texts: string[];
let mails: Array<{ to: string; text: string }>;
let email: string | null;
let tg: boolean | "unknown";
let mailResult: "sent" | "failed" | "unknown";
const deps = (): Deps => ({
  notify: async (_id, text) => {
    await Promise.resolve();
    texts.push(text);
    return tg;
  },
  mail: async (to, _subject, text) => {
    mails.push({ to, text });
    return mailResult;
  },
  payLink: async () => "https://pay.kaspi.kz/pay/abc",
  sellerEmail: async () => email,
});
const marks = () =>
  (db.tables.app_settings ?? []).find((r) => r.key === "renewal_reminded")?.value as
    string | undefined;

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.bots = [{ id: BOT, subscription_expires_at: `${EXPIRES}T00:00:00Z` }];
  texts = [];
  mails = [];
  email = null;
  tg = true;
  mailResult = "sent";
});

describe("воронка продлений", () => {
  it("за 7, 3 и 1 день и в день окончания — ровно по одному, ежедневный крон не дублирует", async () => {
    const t = tenant();
    for (let d = 1; d <= 9; d++) {
      await runRenewals([t], at(d), deps());
      await runRenewals([t], at(d), deps()); // второй прогон в тот же день
    }
    // 1 окт = за 7 дней, 5–6 окт — окно уже d7/d3 (отправлено), 8 окт — день окончания.
    expect(texts).toHaveLength(4);
    expect(texts[0]).toContain("через 7 дней");
    expect(texts[1]).toContain("через 3 дня");
    expect(texts[2]).toContain("завтра");
    expect(texts[3]).toContain("сегодня");
    expect(marks()).toBe(`${EXPIRES}:d7,d3,d1,d0`);
  });

  it("текст: срок, цена продления, ссылка на оплату и «ничего не списываем»", async () => {
    await runRenewals([tenant()], at(1), deps());
    expect(texts[0]).toContain("08.10");
    expect(texts[0]).toContain("19 900 ₸ за месяц");
    expect(texts[0]).toContain("https://pay.kaspi.kz/pay/abc");
    expect(texts[0]).toContain("ничего не списываем");
  });

  it("без ссылки Kaspi — подсказка про админку; без плана — без суммы", async () => {
    await runRenewals([tenant({ plan: null })], at(1), { ...deps(), payLink: async () => null });
    expect(texts[0]).not.toContain("₸");
    expect(texts[0]).toContain("«Модули»");
  });

  it("два крона одновременно — одно сообщение и одно письмо", async () => {
    email = "owner@example.kz";
    const t = tenant();
    const r = await Promise.all([runRenewals([t], at(1), deps()), runRenewals([t], at(1), deps())]);
    expect(texts).toHaveLength(1);
    expect(mails).toHaveLength(1);
    expect(r.flatMap((x) => Object.keys(x))).toHaveLength(1);
  });

  it("клиент оплатил — серия останавливается, у нового срока своя серия", async () => {
    const t = tenant();
    await runRenewals([t], at(1), deps());
    expect(texts).toHaveLength(1);
    // Оплата: срок ушёл на месяц вперёд.
    db.tables.bots = [{ id: BOT, subscription_expires_at: "2026-11-07T00:00:00Z" }];
    for (const d of [4, 6, 7, 8, 9]) await runRenewals([t], at(d), deps());
    expect(texts).toHaveLength(1);
    await runRenewals([t], new Date("2026-10-31T06:00:00Z"), deps());
    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain("07.11");
  });

  it("клиент v1, без served_by, архивный, приостановленный — ничего", async () => {
    for (const t of [
      tenant({}, { served_by: "v1" }),
      tenant({ settings: {} }),
      tenant({ archived: true }),
      tenant({ status: "suspended" }),
    ])
      expect(await runRenewals([t], at(1), deps())).toEqual({});
    expect(texts).toEqual([]);
  });

  it("пробный период ведёт свой обход, здесь тихо", async () => {
    const t = tenant({}, { billing: { trial_until: EXPIRES } });
    expect(await runRenewals([t], at(1), deps())).toEqual({});
    expect(texts).toEqual([]);
  });

  it("просрочку воронка не ведёт: после конца — тихо", async () => {
    expect(await runRenewals([tenant()], at(10), deps())).toEqual({});
  });

  it("не дошло наверняка — метка снята, завтра повторим; могло дойти — не повторяем", async () => {
    const t = tenant();
    tg = false;
    expect((await runRenewals([t], at(1), deps()))[BOT]).toMatchObject({ telegram: "failed" });
    expect(marks()).toBe(`${EXPIRES}:`);
    tg = true;
    await runRenewals([t], at(2), deps());
    expect(texts).toHaveLength(2);
    expect(marks()).toBe(`${EXPIRES}:d7`);

    db.tables.app_settings = [];
    texts = [];
    tg = "unknown";
    await runRenewals([t], at(1), deps());
    await runRenewals([t], at(2), deps());
    expect(texts).toHaveLength(1);
  });

  it("письмо — своя отметка: ушло один раз и не повторяется, даже если ответ SMTP неясен", async () => {
    email = "owner@example.kz";
    mailResult = "unknown";
    const t = tenant();
    const r = await runRenewals([t], at(1), deps());
    expect(r[BOT]).toMatchObject({ telegram: "sent", email: "unknown" });
    await runRenewals([t], at(2), deps());
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("owner@example.kz");
    expect(marks()).toBe(`${EXPIRES}:d7,d7m`);
  });

  it("нет почты у продавца — письма нет, Telegram ушёл", async () => {
    const r = await runRenewals([tenant()], at(1), deps());
    expect(r[BOT]).toMatchObject({ telegram: "sent", email: "none" });
    expect(mails).toEqual([]);
  });

  it("сроки не прочитались — это сбой крона, а не «некого напоминать»", async () => {
    db = withBrokenReads(db, ["bots"]);
    await expect(runRenewals([tenant()], at(1), deps())).rejects.toThrow();
    expect(texts).toEqual([]);
  });
});

describe("текст на четырёх языках", () => {
  for (const lang of ["ru", "kk", "en", "uz"] as const)
    it(`${lang}: срок, сумма и ссылка на месте, служебных ключей нет`, () => {
      const text = renewalText(adminT(lang), "d3", {
        dateLabel: "08.10",
        price: { amount: 19_900, period: "year" },
        payUrl: "https://pay.kaspi.kz/pay/abc",
      });
      expect(text).toContain("08.10");
      expect(text).toContain("19");
      expect(text).toContain("https://pay.kaspi.kz/pay/abc");
      expect(text).not.toMatch(/renew\.|\{/);
    });
});
