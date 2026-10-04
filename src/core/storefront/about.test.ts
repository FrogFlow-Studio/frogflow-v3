import { describe, expect, it } from "vitest";
import { aboutFilled, aboutJsonLd, parseAbout } from "./about";

describe("«О магазине»", () => {
  it("пусто — страницы нет", () => {
    expect(aboutFilled(parseAbout(undefined))).toBe(false);
    expect(aboutFilled(parseAbout({ description: "   ", phone: 5 }))).toBe(false);
  });
  it("чистит пробелы, режет по пределам, строки без переносов", () => {
    const a = parseAbout({
      description: "  привет\r\n\r\n\r\n\r\nмир  ",
      phone: "+7 700\n000",
      hours: "x".repeat(500),
    });
    expect(a.description).toBe("привет\n\nмир");
    expect(a.phone).toBe("+7 700 000");
    expect(a.hours).toHaveLength(200);
    expect(aboutFilled(a)).toBe(true);
  });
  it("разметка: с адресом — LocalBusiness, без — Organization; только https-ссылки", () => {
    const shop = { name: "Лавка", slug: "lavka", origin: "https://x.kz", cover: "/api/img/b/k" };
    const org = aboutJsonLd(shop, parseAbout({ description: "О нас" }), [
      "http://a",
      "https://t.me/b",
    ]);
    expect(org["@type"]).toBe("Organization");
    expect(org.sameAs).toEqual(["https://t.me/b"]);
    expect(org.image).toBe("https://x.kz/api/img/b/k");
    const biz = aboutJsonLd(shop, parseAbout({ address: "Абая 1", hours: "Пн–Пт" }), []);
    expect(biz["@type"]).toBe("LocalBusiness");
    expect(biz.openingHours).toBe("Пн–Пт");
    expect(biz).not.toHaveProperty("sameAs");
  });
});
