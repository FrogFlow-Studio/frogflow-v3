import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { consumeQuota, consumeWebQuota, KEYS, WEB_IP_BUDGET } from "./smart.server";
import { DAILY_LIMIT, formatDailyCount, parseDailyCount, todayUtc } from "./smart-pure";

/**
 * Предохранители умного поиска: бот и сайт тратят один дневной счётчик и один предел расходов
 * магазина; личный кулдаун у бота — в карточке покупателя, у сайта — по сессии браузера и адресу.
 */
let db: FakeDb;
let ctx: TenantContext;

const customer = (): Customer =>
  ({
    userKey: "tg_1",
    state: {},
  }) as unknown as Customer;

function setting(key: string): string | undefined {
  return db.tables.app_settings!.find((r) => r.key === key)?.value as string | undefined;
}

// Кулдаун сессии есть и в памяти процесса (общей для файла): у каждой проверки своя сессия.
let n = 0;
const sid = () => `session-${String(++n).padStart(6, "0")}`;
const count = () => parseDailyCount(setting(KEYS.dailyCount));

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.bot_users = [{ user_key: "tg_1", state: {} }];
  ctx = {
    db,
    tenant: { id: "bot-sq", modules: { smart_search: true }, settings: {} },
  } as unknown as TenantContext;
});

describe("умный поиск на сайте: предохранители", () => {
  it("кулдаун по сессии: вторая попытка той же сессии отказ, другая сессия проходит", async () => {
    const a = sid();
    expect(await consumeWebQuota(ctx, a, null)).toBe(true);
    expect(await consumeWebQuota(ctx, a, null)).toBe(false);
    expect(await consumeWebQuota(ctx, sid(), null)).toBe(true);
    // Отказ по кулдауну дневной счётчик не тратит: засчитаны только два вызова.
    expect(count()).toBe(2);
  });

  it("потолок на адрес: новые сессии с одного адреса упираются в лимит", async () => {
    let passed = 0;
    for (let i = 0; i < WEB_IP_BUDGET.limit + 3; i++)
      if (await consumeWebQuota(ctx, sid(), "1.2.3.4")) passed++;
    expect(passed).toBe(WEB_IP_BUDGET.limit);
    // Другой адрес не затронут.
    expect(await consumeWebQuota(ctx, sid(), "5.6.7.8")).toBe(true);
  });

  it("дневной счётчик общий с ботом: исчерпан ботом — сайт не вызывает модель, и наоборот", async () => {
    db.tables.app_settings!.push({
      bot_id: "bot-sq",
      key: KEYS.dailyCount,
      value: formatDailyCount(DAILY_LIMIT),
    });
    expect(await consumeWebQuota(ctx, sid(), null)).toBe(false);
    expect(await consumeQuota(ctx, customer())).toBe(false);
  });

  it("сайт и бот пишут в один счётчик", async () => {
    expect(await consumeQuota(ctx, customer())).toBe(true);
    expect(await consumeWebQuota(ctx, sid(), null)).toBe(true);
    expect(count()).toBe(2);
  });

  it("дневной предел расходов общий: исчерпан — сайт отказ, причина видна продавцу", async () => {
    db.tables.app_settings!.push({
      bot_id: "bot-sq",
      key: KEYS.dailySpend,
      value: JSON.stringify({
        date: todayUtc(),
        usd: 99,
        calls: 10,
        inputTokens: 1,
        outputTokens: 1,
      }),
    });
    expect(await consumeWebQuota(ctx, sid(), null)).toBe(false);
    expect(setting(KEYS.lastError)).toContain("предел расходов");
  });
});
