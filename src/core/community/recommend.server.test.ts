import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

let tenants: Array<Record<string, unknown>> = [];
const patch = vi.fn(async (_id: string, _p: Record<string, unknown>) => {});
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => tenants,
  patchTenantSettings: (id: string, p: Record<string, unknown>) => patch(id, p),
}));

const srv = await import("./recommend.server");

const author = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  settings: { served_by: "v2", community: { enabled: true, name: `Автор ${id}` }, ...extra },
});
const ctx = (id: string) =>
  ({ tenant: tenants.find((t) => t.id === id) }) as unknown as TenantContext;

beforeEach(() => {
  patch.mockClear();
  tenants = [
    author("a"),
    author("b"),
    author("c"),
    author("off", { community: { enabled: false } }),
  ];
});

describe("рекомендации: сохранение и просмотр", () => {
  it("сохраняет только авторов, которые сейчас в сообществе; себя и выключенных отбрасывает", async () => {
    await srv.saveRecommend(ctx("a"), ["b", "off", "a", "ghost"]);
    expect(patch).toHaveBeenCalledWith("a", { community_recommend: ["b"] });
  });

  it("больше пяти — отказ, а не тихая обрезка", async () => {
    await expect(srv.saveRecommend(ctx("a"), ["1", "2", "3", "4", "5", "6"])).rejects.toThrow(
      "не больше пяти",
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("не участвующий в сообществе не рекомендует", async () => {
    await expect(srv.saveRecommend(ctx("off"), ["a"])).rejects.toThrow("Сначала включите");
    expect(patch).not.toHaveBeenCalled();
  });

  it("просмотр: кандидаты без меня, «взаимно» только когда ответили тем же", async () => {
    tenants = [
      author("a", { community_recommend: ["b", "c"] }),
      author("b", { community_recommend: ["a"] }),
      author("c"),
    ];
    const v = await srv.recommendView(ctx("a"));
    expect(v.candidates.map((c) => c.id)).toEqual(["b", "c"]);
    expect(v.chosen).toEqual(["b", "c"]);
    expect(v.mutual).toEqual(["b"]);
  });
});
