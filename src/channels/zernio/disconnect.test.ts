import { afterEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb } from "../../../tests/fake-db";
import type { Tenant } from "@/core/tenant/types";

/**
 * Отключение аккаунта Instagram/WhatsApp от магазина: аккаунт из профиля
 * клиента отключается и в Zernio, записанный вручную — только у нас;
 * сбой Zernio ничего не меняет; прежняя платформа не затрагивается.
 */
const db = fakeDb();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

function shop(servedBy: string | null = "v2"): Tenant {
  const settings = {
    ...(servedBy ? { served_by: servedBy } : {}),
    slug: "shop",
    zernio: {
      profile_id: "prof-1",
      account_ids: ["ig-1", "wa-1", "manual-1"],
      accounts: [
        { id: "ig-1", platform: "instagram", username: "shop" },
        { id: "wa-1", platform: "whatsapp", name: "Shop" },
      ],
    },
  };
  db.tables.bots = [{ id: "shop", settings: structuredClone(settings) }];
  return { id: "shop", name: "shop", settings } as unknown as Tenant;
}

type Saved = {
  slug?: string;
  zernio: { account_ids: string[]; accounts: { id: string }[] };
};
const saved = () => db.tables.bots![0]!.settings as Saved;

function zernio(status: number) {
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", path: new URL(url).pathname });
      return status === 200
        ? Response.json({ message: "Account disconnected successfully" })
        : Response.json({ error: "x" }, { status });
    }),
  );
  return calls;
}

afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

describe("отключение аккаунта от магазина", () => {
  it("аккаунт профиля: DELETE в Zernio и запись убрана, остальные целы", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    const calls = zernio(200);
    const { disconnectAccount } = await import("./connect.server");
    expect(await disconnectAccount(shop(), "ig-1")).toEqual({ inZernio: true });
    expect(calls).toEqual([{ method: "DELETE", path: "/api/v1/accounts/ig-1" }]);
    expect(saved().zernio.account_ids).toEqual(["wa-1", "manual-1"]);
    expect(saved().zernio.accounts.map((a) => a.id)).toEqual(["wa-1"]);
    expect(saved().slug).toBe("shop");
  });

  it("id оператора вне профиля: только отвязка, Zernio не трогаем", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    const calls = zernio(200);
    const { disconnectAccount } = await import("./connect.server");
    expect(await disconnectAccount(shop(), "manual-1")).toEqual({ inZernio: false });
    expect(calls).toEqual([]);
    expect(saved().zernio.account_ids).toEqual(["ig-1", "wa-1"]);
  });

  it("Zernio ответил 404 (уже отключён): запись у нас всё равно убирается", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    zernio(404);
    const { disconnectAccount } = await import("./connect.server");
    await disconnectAccount(shop(), "wa-1");
    expect(saved().zernio.account_ids).toEqual(["ig-1", "manual-1"]);
  });

  it("сбой Zernio (500): ошибка и ничего не меняется", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    zernio(500);
    const { disconnectAccount } = await import("./connect.server");
    await expect(disconnectAccount(shop(), "ig-1")).rejects.toThrow();
    expect(saved().zernio.account_ids).toEqual(["ig-1", "wa-1", "manual-1"]);
    expect(saved().zernio.accounts).toHaveLength(2);
  });

  it("чужой id не принимается и в Zernio не уходит", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    const calls = zernio(200);
    const { disconnectAccount } = await import("./connect.server");
    await expect(disconnectAccount(shop(), "other-acc")).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("магазин прежней платформы: ничего не делаем", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "sk" });
    const calls = zernio(200);
    const { disconnectAccount } = await import("./connect.server");
    await expect(disconnectAccount(shop(null), "ig-1")).rejects.toThrow();
    expect(calls).toEqual([]);
    expect(saved().zernio.account_ids).toHaveLength(3);
  });
});
