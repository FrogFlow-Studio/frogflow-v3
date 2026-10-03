import { describe, expect, it } from "vitest";
import { buildDraftPrompt, cleanDraft, outreachLinks, stageAfterContact } from "./draft";

const lead = {
  business_name: "Кофейня Север",
  niche: "кофе",
  city: "Астана",
  website_url: null,
  instagram_handle: "sever",
  phone: "77051112233",
  email: "hi@sever.kz",
  signals: "Принимают заказы в директ",
  notes: null,
};

describe("cleanDraft", () => {
  it("снимает кавычки и лишние пустые строки, режет по лимиту; пусто — null", () => {
    expect(cleanDraft("  «Здравствуйте!\n\n\n\nРасскажу про бота»  ")).toBe(
      "Здравствуйте!\n\nРасскажу про бота",
    );
    expect(cleanDraft("x".repeat(5000))).toHaveLength(1200);
    expect(cleanDraft("  \n ")).toBeNull();
  });
});

describe("outreachLinks", () => {
  it("WhatsApp и почта подставляют текст, Instagram — только профиль", () => {
    const links = outreachLinks(lead, "Привет, Север & Ко!");
    expect(links.map((l) => l.channel)).toEqual(["whatsapp", "instagram", "email"]);
    expect(links[0]!.href).toBe(
      `https://wa.me/77051112233?text=${encodeURIComponent("Привет, Север & Ко!")}`,
    );
    expect(links[1]!.href).toBe("https://instagram.com/sever");
    expect(links[2]!.href).toMatch(/^mailto:hi@sever\.kz\?subject=.+&body=/);
  });
  it("нет контакта — нет ссылки; пустой текст — ссылка без текста", () => {
    expect(outreachLinks({ phone: null, instagram_handle: null, email: null }, "x")).toEqual([]);
    expect(outreachLinks({ ...lead, instagram_handle: null, email: null }, "")[0]!.href).toBe(
      "https://wa.me/77051112233",
    );
  });
  it("длинный текст в письме режется, чтобы ссылка открывалась", () => {
    const href = outreachLinks(
      { ...lead, phone: null, instagram_handle: null },
      "я".repeat(1200),
    )[0]!.href;
    expect(href.length).toBeLessThan(9000);
  });
});

describe("stageAfterContact и промпт", () => {
  it("двигает только новый и подходящий", () => {
    expect(stageAfterContact("new")).toBe("contacted");
    expect(stageAfterContact("qualified")).toBe("contacted");
    expect(stageAfterContact("replied")).toBeNull();
    expect(stageAfterContact("hot")).toBeNull();
  });
  it("промпт содержит нишу и сигналы и не содержит телефона", () => {
    const p = buildDraftPrompt({ ...lead, score_reason: "Продаёт в Instagram" });
    expect(p).toContain("Ниша: кофе");
    expect(p).toContain("Принимают заказы в директ");
    expect(p).toContain("Продаёт в Instagram");
    expect(p).not.toContain("77051112233");
  });
});
