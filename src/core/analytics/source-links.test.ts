import { describe, expect, it } from "vitest";
import { botSourceLink, sourceTag, storeSourceLink } from "./source-links";
import { sourceGroup } from "./source-funnel";
import { isWebSource, webSource } from "@/core/storefront/web-source";

describe("метка для ссылки с источником", () => {
  it("латиница и цифры остаются, регистр — нижний", () => {
    expect(sourceTag("Blogger_Anna-2")).toEqual({ ok: true, tag: "blogger_anna-2" });
  });

  it("кириллица переводится в латиницу, пробелы и точки — в _", () => {
    expect(sourceTag("Весна 2026")).toEqual({ ok: true, tag: "vesna_2026" });
    expect(sourceTag("  блогер   Аня. ")).toEqual({ ok: true, tag: "bloger_anya" });
    expect(sourceTag("Щука")).toEqual({ ok: true, tag: "shchuka" });
    expect(sourceTag("Көктем")).toEqual({ ok: true, tag: "koktem" });
    expect(sourceTag("Съезд")).toEqual({ ok: true, tag: "sezd" });
  });

  it("пустое, эмодзи и знаки — не принимаются с причиной", () => {
    expect(sourceTag("   ")).toEqual({ ok: false, reason: "empty" });
    expect(sourceTag("___")).toEqual({ ok: false, reason: "empty" });
    expect(sourceTag("весна🔥")).toEqual({ ok: false, reason: "chars" });
    expect(sourceTag("a/b")).toEqual({ ok: false, reason: "chars" });
    expect(sourceTag("a?start=x")).toEqual({ ok: false, reason: "chars" });
    expect(sourceTag("ж".repeat(21))).toEqual({ ok: false, reason: "long" });
    // «ref-» витрина засчитывает в приглашения друзей.
    expect(sourceTag("ref-anna")).toEqual({ ok: false, reason: "reserved" });
    expect(sourceTag("Ref anna")).toEqual({ ok: true, tag: "ref_anna" });
    expect(sourceTag("a".repeat(40))).toEqual({ ok: true, tag: "a".repeat(40) });
  });

  it("ссылка на бота укладывается в правила Telegram и видна в воронке", () => {
    const tag = (sourceTag("щ".repeat(10)) as { tag: string }).tag;
    const link = botSourceLink("@shop_bot", tag);
    expect(link).toBe(`https://t.me/shop_bot?start=src_${tag}`);
    const payload = new URL(link).searchParams.get("start")!;
    expect(payload).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    // Та же метка с витрины (utm_source) — та же строка воронки.
    expect(sourceGroup(payload)).toBe(`tag:${tag}`);
    expect(sourceGroup(`site:${tag}`)).toBe(`tag:${tag}`);
  });

  it("адрес витрины с меткой витрина принимает как источник", () => {
    const link = storeSourceLink("https://www.frogflow.tech/s/shop", "vesna_2026");
    expect(link).toBe("https://www.frogflow.tech/s/shop?utm_source=vesna_2026");
    const src = webSource({ utm_source: new URL(link).searchParams.get("utm_source") });
    expect(src).toBe("site:vesna_2026");
    expect(isWebSource(src)).toBe(true);
    expect(storeSourceLink("https://x.kz/s/a?lang=en", "t")).toBe(
      "https://x.kz/s/a?lang=en&utm_source=t",
    );
  });
});
