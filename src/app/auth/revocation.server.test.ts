import { beforeEach, describe, expect, it, vi } from "vitest";

/** operator_settings в памяти: ключ → значение; плюс счётчик запросов. */
const rows = new Map<string, string>();
const stats = { selects: 0, fail: false };

vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    from: () => ({
      select: () => ({
        eq: (_c: string, key: string) => ({
          maybeSingle: async () => {
            stats.selects++;
            if (stats.fail) return { data: null, error: { message: "db down" } };
            return { data: rows.has(key) ? { key } : null, error: null };
          },
        }),
      }),
      upsert: async (r: { key: string; value: string }) => {
        rows.set(r.key, r.value);
        return { error: null };
      },
      delete: () => ({
        like: (_c: string, prefix: string) => ({
          lt: async (_c2: string, before: string) => {
            for (const [k, v] of rows)
              if (k.startsWith(prefix.replace("%", "")) && v < before) rows.delete(k);
            return { error: null };
          },
        }),
      }),
    }),
  }),
}));

const { isSessionRevoked, revokeSession, resetRevocationCache } =
  await import("./revocation.server");

const SID = "11111111-2222-3333-4444-555555555555";
const DAY = 24 * 3600 * 1000;

beforeEach(() => {
  rows.clear();
  stats.selects = 0;
  stats.fail = false;
  resetRevocationCache();
});

describe("отзыв сессии при выходе", () => {
  it("после выхода та же сессия отозвана — и на другой копии функции тоже", async () => {
    const now = 100 * DAY;
    expect(await isSessionRevoked(SID, now)).toBe(false);
    await revokeSession(SID, now - DAY, now);
    expect(await isSessionRevoked(SID, now)).toBe(true);
    // другая копия функции: локального кеша нет, ответ из базы
    resetRevocationCache();
    expect(await isSessionRevoked(SID, now)).toBe(true);
    expect(rows.get(`session_revoked:${SID}`)).toBe(new Date(now - DAY + 14 * DAY).toISOString());
  });

  it("«не отозвана» кешируется на 30 секунд, потом база спрашивается снова", async () => {
    const now = 100 * DAY;
    await isSessionRevoked(SID, now);
    await isSessionRevoked(SID, now + 10_000);
    expect(stats.selects).toBe(1);
    await isSessionRevoked(SID, now + 31_000);
    expect(stats.selects).toBe(2);
  });

  it("база не ответила — сессия не принимается (исключение)", async () => {
    stats.fail = true;
    await expect(isSessionRevoked(SID, 0)).rejects.toThrow(/db down/);
  });

  it("истёкшие записи об отзыве подчищаются при следующем выходе", async () => {
    const old = "99999999-2222-3333-4444-555555555555";
    rows.set(`session_revoked:${old}`, new Date(DAY).toISOString());
    rows.set("payout_requisites", "не трогать");
    await revokeSession(SID, 50 * DAY, 60 * DAY);
    expect(rows.has(`session_revoked:${old}`)).toBe(false);
    expect(rows.has(`session_revoked:${SID}`)).toBe(true);
    expect(rows.get("payout_requisites")).toBe("не трогать");
  });
});
