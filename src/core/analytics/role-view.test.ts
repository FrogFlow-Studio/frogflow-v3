import { describe, expect, it } from "vitest";
import { accountantView } from "./role-view";

const full = {
  sources: [{ source: "all" }, { source: "tag:vesna" }],
  links: { bot: "shop_bot", store: "https://x.example/s/shop" },
  promote: { quality: [], stock: [], total: { quality: 0, stock: 0 } },
  funnel: [{ channel: "all" }],
  customers: { weeks: [] },
};

describe("аналитика по ролям (У5)", () => {
  it("бухгалтер: отчёты остаются, источников, ссылок и советов нет", () => {
    const v = accountantView(full, true);
    expect(v.sources).toEqual([]);
    expect(v.links).toEqual({ bot: null, store: null });
    expect(v.promote).toBeNull();
    expect(v.funnel).toEqual(full.funnel);
    expect(v.customers).toEqual(full.customers);
  });

  it("владелец, менеджер и просмотр видят всё", () => {
    expect(accountantView(full, false)).toBe(full);
  });
});
