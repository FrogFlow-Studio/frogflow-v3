import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/core/tenant/types";

/**
 * Умный поиск на витрине: платный вызов модели — только у клиента v2 с включённым
 * переключателем, только когда обычный поиск пуст, и только после предохранителей.
 */
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse: (d: unknown) => unknown = (d) => d;
    const b = {
      validator(v: (d: unknown) => unknown) {
        parse = v;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        return async (a: { data: unknown }) => h({ data: parse(a.data) });
      },
    };
    return b;
  },
}));
let tenant: Tenant;
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => tenant,
  tenantContext: () => ({ tenant }),
}));
const enabled = vi.fn(async () => true);
const quota = vi.fn(async () => true);
const model = vi.fn(async (): Promise<string[] | null> => ["p1", "p2"]);
vi.mock("@/core/search/smart.server", () => ({
  smartSearchEnabled: enabled,
  consumeWebQuota: quota,
  smartSearchProductIds: model,
}));
const regular = vi.fn(async () => ({ items: [] as unknown[] }));
const byIds = vi.fn(async (_ctx: unknown, ids: string[]) => ids.map((id) => ({ id })));
vi.mock("@/core/storefront/catalog", () => ({
  storeCatalogPage: regular,
  storeProductsByIds: byIds,
}));
vi.mock("@/app/auth/login-guard.server", () => ({ clientIp: () => "9.9.9.9" }));

const { storeSmartSearchFn } = await import("./smart-search.functions");
const base = {
  id: "b1",
  archived: false,
  modules: { shop: true, web_storefront: true, smart_search: true },
  settings: { served_by: "v2", slug: "shop" },
} as unknown as Tenant;
const call = (over: Record<string, unknown> = {}) =>
  storeSmartSearchFn({
    data: { slug: "shop", q: "что-то к чаю", session: "session-12345678", ...over },
  });

beforeEach(() => {
  tenant = base;
  for (const f of [enabled, quota, model, regular, byIds]) f.mockClear();
  enabled.mockResolvedValue(true);
  quota.mockResolvedValue(true);
  model.mockResolvedValue(["p1", "p2"]);
  regular.mockResolvedValue({ items: [] });
});

describe("умный поиск на витрине", () => {
  it("обычный поиск пуст, всё разрешено — товары по смыслу в порядке модели; сессия и адрес идут в предохранитель", async () => {
    expect(await call()).toEqual({ state: "ok", items: [{ id: "p1" }, { id: "p2" }] });
    expect(quota).toHaveBeenCalledWith(expect.anything(), "session-12345678", "9.9.9.9");
  });

  it("выключен у продавца — модель и предохранители не трогаются", async () => {
    enabled.mockResolvedValue(false);
    expect(await call()).toEqual({ state: "off", items: [] });
    expect(quota).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });

  it("обычный поиск нашёл — платного вызова нет, счёт не тратится (клиенту не верим)", async () => {
    regular.mockResolvedValue({ items: [{ id: "x" }] });
    expect(await call()).toEqual({ state: "none", items: [] });
    expect(quota).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });

  it("кулдаун или лимит — «занято», модель не вызывается", async () => {
    quota.mockResolvedValue(false);
    expect(await call()).toEqual({ state: "busy", items: [] });
    expect(model).not.toHaveBeenCalled();
  });

  it("модель ничего не вернула или сбой — «нет», без ошибки покупателю", async () => {
    model.mockResolvedValue(null);
    expect(await call()).toEqual({ state: "none", items: [] });
    model.mockResolvedValue([]);
    expect(await call()).toEqual({ state: "none", items: [] });
  });

  it.each([
    ["клиент прежней платформы", { ...base, settings: { slug: "shop" } }],
    ["архив", { ...base, archived: true }],
    ["без каталога", { ...base, modules: { shop: true, legal_docs: true } }],
  ])("%s — «не найден», проверки не запускаются", async (_n, t) => {
    tenant = t as unknown as Tenant;
    await expect(call()).rejects.toBeTruthy();
    expect(enabled).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });

  it("слишком короткий запрос и чужой вид сессии не принимаются", async () => {
    await expect(call({ q: "а" })).rejects.toBeTruthy();
    await expect(call({ session: "x" })).rejects.toBeTruthy();
    expect(model).not.toHaveBeenCalled();
  });
});
