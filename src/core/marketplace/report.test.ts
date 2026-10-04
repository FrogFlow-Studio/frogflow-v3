import { describe, expect, it } from "vitest";
import { REPORT_REASONS, cleanReport, reportDay, reportEventId, reportTarget } from "./report";

const UUID = "b41a34cb-7944-441b-8f71-503184fc0f1f";

describe("разбор жалобы", () => {
  it("причина только из списка", () => {
    for (const reason of REPORT_REASONS)
      expect(cleanReport({ slug: "shop", reason, text: "Не пришёл заказ" }).ok).toBe(true);
    expect(cleanReport({ slug: "shop", reason: "spam", text: "x" })).toEqual({
      ok: false,
      error: "reason",
    });
    expect(cleanReport({ slug: "shop" })).toEqual({ ok: false, error: "reason" });
  });

  it("«другое» без текста — отказ, остальные причины без текста принимаются", () => {
    expect(cleanReport({ slug: "shop", reason: "other", text: "  " })).toEqual({
      ok: false,
      error: "text",
    });
    expect(cleanReport({ slug: "shop", reason: "fraud", text: "" }).ok).toBe(true);
  });

  it("текст чистится и режется, адрес и товар приводятся к виду", () => {
    const r = cleanReport({
      slug: " Sweet-Shop ",
      productId: UUID.toUpperCase(),
      reason: "fraud",
      text: `  много   пробелов ${"я".repeat(2000)}`,
    });
    expect(r.ok && r.value.slug).toBe("sweet-shop");
    expect(r.ok && r.value.productId).toBe(UUID);
    expect(r.ok && r.value.text.startsWith("много пробелов")).toBe(true);
    expect(r.ok && r.value.text.length).toBe(1000);
    const bad = cleanReport({ slug: "s", productId: "не-id", reason: "fraud" });
    expect(bad.ok && bad.value.productId).toBeNull();
  });
});

describe("ключ жалобы", () => {
  it("один адрес на один объект в день даёт один ключ, другой день и другой объект — другой", () => {
    const day = reportDay(new Date("2026-10-04T23:59:59Z"));
    expect(day).toBe("2026-10-04");
    const a = reportEventId("bot", reportTarget(null), "ip", "a".repeat(32), day);
    expect(a).toBe(reportEventId("bot", "shop", "ip", "a".repeat(32), day));
    expect(a).not.toBe(reportEventId("bot", "shop", "ip", "a".repeat(32), "2026-10-05"));
    expect(a).not.toBe(reportEventId("bot", reportTarget(UUID), "ip", "a".repeat(32), day));
    expect(a).not.toBe(reportEventId("bot", "shop", "device", "a".repeat(32), day));
    expect(a.length).toBeLessThan(120);
  });
});
