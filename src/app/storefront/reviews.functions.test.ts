import { describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/core/tenant/types";

/** Отзывы на витрине: клиент прежней платформы, архив, без витрины — «не найден». */
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse: (d: unknown) => unknown = (d) => d;
    const b = {
      validator(v: (d: unknown) => unknown) {
        parse = v;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        return (a: { data: unknown }) => h({ data: parse(a.data) });
      },
    };
    return b;
  },
}));
let tenant: Tenant;
const approved = vi.fn(async () => [{ id: "r1" }]);
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => tenant,
  tenantContext: () => ({ tenant }),
}));
vi.mock("@/core/reviews/photos.server", () => ({ approvedReviews: approved }));

const { storeReviewsFn } = await import("./reviews.functions");
const ID = "22222222-2222-2222-2222-222222222222";
const base = {
  id: "b1",
  archived: false,
  modules: { shop: true, web_storefront: true },
  settings: { served_by: "v2", slug: "shop" },
} as unknown as Tenant;

describe("отзывы на витрине", () => {
  it("витрина v2 — одобренные отзывы", async () => {
    tenant = base;
    expect(await storeReviewsFn({ data: { slug: "shop", id: ID } })).toEqual([{ id: "r1" }]);
  });

  it.each([
    ["клиент прежней платформы", { ...base, settings: { slug: "shop" } }],
    ["архив", { ...base, archived: true }],
    ["без витрины (только юр. страницы)", { ...base, modules: { shop: true, legal_docs: true } }],
  ])("%s — «не найден», база не читается", async (_n, t) => {
    tenant = t as unknown as Tenant;
    approved.mockClear();
    await expect(storeReviewsFn({ data: { slug: "shop", id: ID } })).rejects.toBeTruthy();
    expect(approved).not.toHaveBeenCalled();
  });
});
