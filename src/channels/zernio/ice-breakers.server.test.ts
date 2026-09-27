import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/core/tenant/types";

/** Быстрые вопросы ставятся только клиенту v2, только при смене набора, и снимаются при откате. */
let configured = true;
vi.mock("./api.server", () => ({
  zernioConfigured: () => configured,
  setInstagramIceBreakers: vi.fn(),
  deleteInstagramIceBreakers: vi.fn(),
}));

const patches: Array<Record<string, unknown>> = [];
let settings: Record<string, string> = {};
let readError: { message: string } | null = null;
/** app_settings клиента: select("key, value").in("key", keys). */
const tenantDb = {
  from: () => ({
    select: () => ({
      in: async (_col: string, keys: string[]) =>
        readError
          ? { data: null, error: readError }
          : {
              data: keys.filter((k) => k in settings).map((k) => ({ key: k, value: settings[k] })),
              error: null,
            },
    }),
  }),
};
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantContext: (t: Tenant) => ({ tenant: t, db: tenantDb }),
  patchTenantSettings: vi.fn(async (_id: string, p: Record<string, unknown>) => {
    patches.push(p);
  }),
  requireTenant: vi.fn(),
}));

/** Свежее чтение served_by: по очереди из списка, дальше — последнее значение. */
let freshServedBy: string[] = [];
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            const v = freshServedBy.length > 1 ? freshServedBy.shift() : freshServedBy[0];
            return { data: { settings: { served_by: v } }, error: null };
          },
        }),
      }),
    }),
  }),
}));

const { ensureIceBreakers, releaseIceBreakersToV1, iceBreakersVersion } =
  await import("./ice-breakers.server");

function tenant(over: Partial<Tenant["settings"]> = {}, servedBy = "v2"): Tenant {
  return {
    id: "b1",
    archived: false,
    modules: { instagram: true, dm_shop: true },
    settings: {
      served_by: servedBy,
      zernio: {
        account_ids: ["ig1", "ig2", "wa1", "igX"],
        accounts: [
          { id: "igOld", platform: "instagram" },
          { id: "ig2", platform: "instagram" },
          { id: "wa1", platform: "whatsapp" },
          { id: "ig1", platform: "instagram" },
          { id: "igX", platform: "instagram", expired: true },
        ],
      },
      ...over,
    },
  } as unknown as Tenant;
}

function fakeApi() {
  const calls: Array<[string, string, unknown?]> = [];
  return {
    calls,
    api: {
      set: vi.fn(async (id: string, items: unknown) => {
        calls.push(["set", id, items]);
      }),
      clear: vi.fn(async (id: string) => {
        calls.push(["clear", id]);
      }),
    },
  };
}

const ON = JSON.stringify({ enabled: true });

beforeEach(() => {
  configured = true;
  patches.length = 0;
  settings = {};
  readError = null;
  freshServedBy = ["v2"];
});

describe("быстрые вопросы Instagram в аккаунтах клиента", () => {
  it("клиента v1 не трогаем", async () => {
    settings.instagram_ice_breakers = ON;
    const { api, calls } = fakeApi();
    expect(await ensureIceBreakers(tenant({}, "v1"), api)).toEqual({ ok: true, action: "skipped" });
    expect(calls).toEqual([]);
  });

  it("включены — ставим в каждый рабочий аккаунт Instagram и пишем отпечаток", async () => {
    settings.instagram_ice_breakers = ON;
    const { api, calls } = fakeApi();
    const r = await ensureIceBreakers(tenant(), api);
    expect(r).toEqual({ ok: true, action: "set" });
    expect(calls.map((c) => [c[0], c[1]])).toEqual([
      ["set", "ig1"],
      ["set", "ig2"],
    ]);
    expect((calls[0]![2] as unknown[]).length).toBe(4);
    const v = (patches[0]!.zernio as { ice_breakers_v: string }).ice_breakers_v;
    expect(v).toMatch(/^[0-9a-f]{16}$/);

    // Набор тот же — Zernio не зовём.
    const again = fakeApi();
    const r2 = await ensureIceBreakers(
      tenant({ zernio: { ...tenant().settings.zernio, ice_breakers_v: v } }),
      again.api,
    );
    expect(r2.action).toBe("unchanged");
    expect(again.calls).toEqual([]);
  });

  it("выключены после нашей установки — снимаем; не ставили — чужие подсказки не трогаем", async () => {
    const { api, calls } = fakeApi();
    const ours = tenant({ zernio: { ...tenant().settings.zernio, ice_breakers_v: "abc" } });
    expect((await ensureIceBreakers(ours, api)).action).toBe("cleared");
    expect(calls).toEqual([
      ["clear", "ig1"],
      ["clear", "ig2"],
      ["clear", "igX"],
    ]);
    expect(patches).toEqual([{ zernio: { ice_breakers_v: "" } }]);

    const none = fakeApi();
    expect((await ensureIceBreakers(tenant(), none.api)).action).toBe("unchanged");
    expect(none.calls).toEqual([]);
  });

  it("сбой Zernio — отпечаток не пишем, крон повторит", async () => {
    settings.instagram_ice_breakers = ON;
    const { api } = fakeApi();
    api.set.mockRejectedValueOnce(new Error("Zernio API 400"));
    const r = await ensureIceBreakers(tenant(), api);
    expect(r).toMatchObject({ ok: false, error: "ig1: Zernio API 400" });
    expect(patches).toEqual([]);
  });

  it("новый аккаунт Instagram меняет отпечаток", () => {
    const items = [{ question: "Каталог", payload: "IB:catalog" }];
    expect(iceBreakersVersion(["ig1"], items)).not.toBe(iceBreakersVersion(["ig1", "ig2"], items));
    expect(iceBreakersVersion([], items)).toBe("");
  });

  it("откат на v1 снимает только то, что ставили мы", async () => {
    const { api, calls } = fakeApi();
    await releaseIceBreakersToV1(tenant(), api);
    expect(calls).toEqual([]);
    await releaseIceBreakersToV1(
      tenant({ zernio: { ...tenant().settings.zernio, ice_breakers_v: "abc" } }),
      api,
    );
    expect(calls).toEqual([
      ["clear", "ig1"],
      ["clear", "ig2"],
      ["clear", "igX"],
    ]);
    expect(patches).toEqual([{ zernio: { ice_breakers_v: "" } }]);
  });

  it("откат: сбой в одном аккаунте — остальные снимаем, отпечаток оставляем, ошибка наверх", async () => {
    const { api, calls } = fakeApi();
    api.clear.mockRejectedValueOnce(new Error("Zernio API 500"));
    await expect(
      releaseIceBreakersToV1(
        tenant({ zernio: { ...tenant().settings.zernio, ice_breakers_v: "abc" } }),
        api,
      ),
    ).rejects.toThrow(/ig1: Zernio API 500/);
    expect(calls).toEqual([
      ["clear", "ig2"],
      ["clear", "igX"],
    ]);
    expect(patches).toEqual([]);
  });

  it("сбой чтения настроек — ошибка, подсказки не снимаем", async () => {
    readError = { message: "timeout" };
    const { api, calls } = fakeApi();
    const ours = tenant({ zernio: { ...tenant().settings.zernio, ice_breakers_v: "abc" } });
    await expect(ensureIceBreakers(ours, api)).rejects.toThrow();
    expect(calls).toEqual([]);
    expect(patches).toEqual([]);
  });

  it("аккаунт из снимка, но не из account_ids, не трогаем", async () => {
    settings.instagram_ice_breakers = ON;
    const { api, calls } = fakeApi();
    await ensureIceBreakers(tenant(), api);
    expect(calls.map((c) => c[1])).not.toContain("igOld");
  });

  it("клиента откатили на v1 до вызова Zernio — ничего не ставим", async () => {
    settings.instagram_ice_breakers = ON;
    freshServedBy = ["v1"];
    const { api, calls } = fakeApi();
    expect(await ensureIceBreakers(tenant(), api)).toEqual({ ok: true, action: "skipped" });
    expect(calls).toEqual([]);
    expect(patches).toEqual([]);
  });

  it("клиента откатили на v1 во время вызовов Zernio — отпечаток не пишем, поставленное снимаем", async () => {
    settings.instagram_ice_breakers = ON;
    freshServedBy = ["v2", "v1"];
    const { api, calls } = fakeApi();
    expect(await ensureIceBreakers(tenant(), api)).toEqual({ ok: true, action: "skipped" });
    // Поставленное снимаем обратно: откат прошёл без отпечатка и его не снимет.
    expect(calls.map((c) => [c[0], c[1]])).toEqual([
      ["set", "ig1"],
      ["set", "ig2"],
      ["clear", "ig1"],
      ["clear", "ig2"],
    ]);
    expect(patches).toEqual([]);
  });
});
