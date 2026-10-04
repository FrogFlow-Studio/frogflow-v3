import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * platformStatus читает базу: снимки здоровья ботов, состояние вебхука Zernio,
 * кроны. Публичный ответ не раскрывает имена клиентов, id и токены; упавшее
 * чтение превращается в «нет данных».
 */
const NOW = new Date("2026-09-28T10:10:00Z");
let snapshots: Array<{ ok: boolean; at: string; bot_id: string; error: string }> = [];
let platformAlerts: string | null = null;
let failRead = false;
let failCrons = false;
let dirFails = false;

vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const result = () => {
        if (failRead) return { data: null, error: { message: "db down" } };
        if (table === "operator_settings")
          return { data: platformAlerts ? { value: platformAlerts } : null, error: null };
        return { data: snapshots, error: null };
      };
      for (const m of ["select", "gte", "order", "eq", "range", "limit"]) q[m] = () => q;
      q.maybeSingle = async () => result();
      q.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
      return q;
    },
  }),
}));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => {
    if (dirFails) throw new Error("directory down");
    return [{ id: "secret-bot-id", name: "Секретный магазин" }];
  },
}));
vi.mock("@/app/operator/cron-status.server", () => ({
  listCronStatus: async () => {
    if (failCrons) throw new Error("cron read failed");
    return [
      "ensure-webhook",
      "health",
      "comment-dm-fallback",
      "subscriptions",
      "broadcast",
      "cart-reminder",
      "fulfillment-reminder",
      "course-lives",
      "vip",
      "retention",
    ].map((job) => ({
      job,
      stale: false,
      last: { at: "2026-09-28T10:05:00Z", ok: true },
    }));
  },
}));

const { platformStatus } = await import("./status.server");
const get = (r: Awaited<ReturnType<typeof platformStatus>>, key: string) =>
  r.services.find((s) => s.key === key)!;
const snap = (i: number, ok: boolean) => ({
  ok,
  at: `2026-09-28T10:0${i % 10}:00Z`,
  bot_id: `bot-${i}`,
  error: "Unauthorized token 123:SECRET",
});

beforeEach(() => {
  snapshots = [snap(1, true), snap(2, true), snap(3, true), snap(4, true)];
  platformAlerts = null;
  failRead = false;
  failCrons = false;
  dirFails = false;
});

describe("platformStatus", () => {
  it("не раскрывает имена клиентов, id ботов и тексты ошибок", async () => {
    snapshots = [snap(1, false), snap(2, false), snap(3, true)];
    platformAlerts = JSON.stringify({
      "zernio:webhook": {
        fails: 3,
        oks: 0,
        since: "2026-09-28T09:00:00Z",
        error: "TOKEN-LEAK",
        notified: true,
      },
      "account:bot-9:acc1": {
        fails: 5,
        oks: 0,
        since: "2026-09-28T08:00:00Z",
        error: "TOKEN-LEAK",
        notified: true,
      },
    });
    const out = JSON.stringify(await platformStatus(NOW));
    expect(out).not.toMatch(/Секретный|secret-bot-id|bot-\d|SECRET|TOKEN-LEAK|acc1/);
    expect(out).toContain("2026-09-28T09:00:00Z");
  });

  it("упали два бота из трёх — Telegram с перебоями; один отозванный токен — нет", async () => {
    snapshots = [snap(1, false), snap(2, false), snap(3, true)];
    expect(get(await platformStatus(NOW), "telegram").state).toBe("degraded");
    snapshots = [snap(1, false), snap(2, true), snap(3, true), snap(4, true)];
    expect(get(await platformStatus(NOW), "telegram").state).toBe("ok");
  });

  it("вебхук Zernio в сбое — Instagram и WhatsApp с перебоями; нет состояния — нет данных", async () => {
    platformAlerts = JSON.stringify({
      "zernio:webhook": {
        fails: 2,
        oks: 0,
        since: "2026-09-28T09:00:00Z",
        error: null,
        notified: true,
      },
    });
    const bad = await platformStatus(NOW);
    expect(get(bad, "instagram").state).toBe("degraded");
    expect(get(bad, "whatsapp").state).toBe("degraded");
    platformAlerts = null;
    expect(get(await platformStatus(NOW), "whatsapp").state).toBe("unknown");
  });

  it("чтение упало — «нет данных», а не «работает»", async () => {
    failRead = true;
    const r = await platformStatus(NOW);
    expect(get(r, "telegram").state).toBe("unknown");
    expect(get(r, "instagram").state).toBe("unknown");
    failRead = false;
    failCrons = true;
    const r2 = await platformStatus(NOW);
    expect(get(r2, "broadcasts").state).toBe("unknown");
    expect(get(r2, "storefront").state).toBe("ok");
  });

  it("база недоступна — витрина с перебоями", async () => {
    dirFails = true;
    const r = await platformStatus(NOW);
    expect(get(r, "storefront").state).toBe("degraded");
    expect(r.overall).toBe("degraded");
  });
});
