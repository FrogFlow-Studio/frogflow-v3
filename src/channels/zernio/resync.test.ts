import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb } from "../../../tests/fake-db";
import type { Tenant } from "@/core/tenant/types";

/**
 * Сверка аккаунтов после переподключения (магазин найден по профилю):
 * вызывается на каждое такое событие, поэтому не чаще раза в окно, и пишет
 * условно — из одновременных прогонов пишет один, чужие ключи settings целы.
 */
const db = fakeDb();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const NOW = new Date("2026-09-27T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

function shop(syncedAt: string | null): Tenant {
  const settings = {
    served_by: "v2",
    slug: "shop",
    zernio: { profile_id: "prof-1", account_ids: ["acc-old"], synced_at: syncedAt ?? undefined },
  };
  db.tables.bots = [{ id: "shop", settings: structuredClone(settings) }];
  return { id: "shop", name: "shop", settings } as unknown as Tenant;
}

type Saved = {
  slug?: string;
  timezone?: string;
  rev?: number;
  zernio: { account_ids: string[]; synced_at?: string };
};
const saved = () => db.tables.bots![0]!.settings as Saved;

function zernioAccounts(ids: string[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(new URL(url).pathname);
      return Response.json({
        accounts: ids.map((id) => ({ _id: id, platform: "instagram", profileId: "prof-1" })),
      });
    }),
  );
  return calls;
}

afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

describe("сверка после переподключения аккаунта", () => {
  it("дописывает новый id и сохраняет остальные ключи settings", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    const tenant = shop(ago(30));
    zernioAccounts(["acc-new"]);
    const { resyncAfterReconnect } = await import("./connect.server");
    expect(await resyncAfterReconnect(tenant, NOW)).toBe(true);
    expect(saved().slug).toBe("shop");
    expect(saved().zernio.account_ids).toEqual(["acc-old", "acc-new"]);
    expect(saved().zernio.synced_at).toBe(NOW.toISOString());
  });

  it("сверка была меньше 5 минут назад — Zernio не спрашиваем и не пишем", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    const tenant = shop(ago(2));
    const calls = zernioAccounts(["acc-new"]);
    const { resyncAfterReconnect } = await import("./connect.server");
    expect(await resyncAfterReconnect(tenant, NOW)).toBe(false);
    expect(calls).toEqual([]);
    expect(saved().zernio.account_ids).toEqual(["acc-old"]);
  });

  it("два события одновременно: пишет один прогон, второй видит свежую сверку и молчит", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    const tenant = shop(null);
    zernioAccounts(["acc-new"]);
    const { resyncAfterReconnect } = await import("./connect.server");
    const first = await resyncAfterReconnect(tenant, NOW);
    // Второй прогон держит тот же устаревший снимок арендатора (synced_at: null).
    const second = await resyncAfterReconnect(tenant, new Date(NOW.getTime() + 1000));
    expect([first, second]).toEqual([true, false]);
    expect(saved().zernio.synced_at).toBe(NOW.toISOString());
  });

  it("продавец сохранил другой ключ между чтением и записью — его ключ цел, сверка дописана", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    const tenant = shop(ago(30));
    zernioAccounts(["acc-new"]);
    const realFrom = db.from.bind(db);
    let reads = 0;
    db.from = ((table: string) => {
      const q = realFrom(table as "bots");
      if (table !== "bots") return q;
      const single = q.maybeSingle.bind(q);
      q.maybeSingle = (async () => {
        const r = await single();
        // Сразу после первого чтения продавец сохраняет часовой пояс.
        const row = db.tables.bots![0]!;
        // Как patchTenantSettings: ключ и номер версии settings.rev растут вместе.
        if (reads++ === 0) {
          const cur = row.settings as { rev?: number };
          row.settings = { ...cur, timezone: "Asia/Almaty", rev: (cur.rev ?? 0) + 1 };
        }
        return r;
      }) as unknown as typeof q.maybeSingle;
      return q;
    }) as typeof db.from;
    try {
      const { resyncAfterReconnect } = await import("./connect.server");
      expect(await resyncAfterReconnect(tenant, NOW)).toBe(true);
    } finally {
      db.from = realFrom;
    }
    expect(reads).toBe(2);
    expect(saved()).toMatchObject({ slug: "shop", timezone: "Asia/Almaty", rev: 2 });
    expect(saved().zernio.account_ids).toEqual(["acc-old", "acc-new"]);
  });

  it("каждая запись settings растит rev: и сверка, и patchTenantSettings", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    const tenant = shop(ago(30));
    zernioAccounts(["acc-new"]);
    const { resyncAfterReconnect } = await import("./connect.server");
    expect(await resyncAfterReconnect(tenant, NOW)).toBe(true);
    expect(saved().rev).toBe(1);
    const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
    await patchTenantSettings("shop", { timezone: "Asia/Almaty" });
    expect(saved()).toMatchObject({ rev: 2, timezone: "Asia/Almaty" });
    expect(saved().zernio.account_ids).toEqual(["acc-old", "acc-new"]);
  });

  it("настройки не прочитались — сбой и никакой записи, served_by и slug целы", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    const tenant = shop(ago(30));
    zernioAccounts(["acc-new"]);
    const before = structuredClone(db.tables.bots![0]!.settings);
    const realFrom = db.from.bind(db);
    db.from = ((table: string) => {
      const q = realFrom(table as "bots");
      if (table === "bots")
        q.maybeSingle = (async () => ({
          data: null,
          error: { message: "canceling statement due to statement timeout" },
        })) as unknown as typeof q.maybeSingle;
      return q;
    }) as typeof db.from;
    try {
      const { resyncAfterReconnect } = await import("./connect.server");
      await expect(resyncAfterReconnect(tenant, NOW)).rejects.toThrow(/не прочитала/);
    } finally {
      db.from = realFrom;
    }
    expect(db.tables.bots![0]!.settings).toEqual(before);
  });
});
