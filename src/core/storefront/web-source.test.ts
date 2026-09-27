import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer, getCustomer } from "@/core/customers/customers";
import { isWebSource, webSource } from "./web-source";
import { rememberFirstSource } from "./web-order";

describe("источник покупателя с сайта", () => {
  it("utm_source, utm_campaign и ref", () => {
    expect(webSource({ utm_source: "google", utm_campaign: "spring-sale" })).toBe(
      "site:google/spring-sale",
    );
    expect(webSource({ ref: "anna_01" })).toBe("site:ref-anna_01");
    expect(webSource({ utm_source: "ig", ref: "blog" })).toBe("site:ig ref-blog");
    expect(webSource({ utm_campaign: "x" })).toBeNull();
    expect(webSource({})).toBeNull();
  });

  it("чужие символы и длинные значения отбрасываются", () => {
    expect(webSource({ utm_source: "<script>" })).toBeNull();
    expect(webSource({ utm_source: "a".repeat(41) })).toBeNull();
    expect(webSource({ utm_source: "vk", utm_campaign: "лето" })).toBe("site:vk");
    expect(webSource({ utm_source: "a".repeat(40), ref: "b".repeat(40) })!.length).toBe(64);
  });

  it("с сервера принимается только строка вида site:…", () => {
    expect(isWebSource("site:google/spring")).toBe(true);
    expect(isWebSource("p_123")).toBe(false);
    expect(isWebSource("site:<b>")).toBe(false);
    expect(isWebSource("site:" + "a".repeat(60))).toBe(false);
    expect(isWebSource(42)).toBe(false);
  });
});

describe("запись в карточку покупателя", () => {
  async function setup(state: Record<string, unknown> = {}) {
    const db = fakeDb();
    db.tables.bot_users = [];
    const ctx = {
      tenant: { id: "bot-1", modules: {}, settings: {} },
      db,
    } as unknown as TenantContext;
    const c = await upsertCustomer(ctx, "web", "abc", { firstName: "Анна", contactPhone: null });
    if (Object.keys(state).length) db.tables.bot_users![0]!.state = state;
    return { ctx, c };
  }

  it("первый источник пишется", async () => {
    const { ctx, c } = await setup();
    await rememberFirstSource(ctx, c, "site:google/spring");
    expect((await getCustomer(ctx, c.userKey))!.state.first_source).toBe("site:google/spring");
  });

  it("уже записанный источник не перезаписывается, мусор не пишется", async () => {
    const { ctx, c } = await setup({ first_source: "p_promo" });
    await rememberFirstSource(ctx, c, "site:google/spring");
    expect((await getCustomer(ctx, c.userKey))!.state.first_source).toBe("p_promo");
    const other = await setup();
    await rememberFirstSource(other.ctx, other.c, "<script>");
    expect((await getCustomer(other.ctx, other.c.userKey))!.state.first_source).toBeUndefined();
  });
});
