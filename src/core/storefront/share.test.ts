import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import {
  absoluteUrl,
  productMeta,
  shareText,
  shopLinks,
  shopManifest,
  shopMeta,
  shortName,
  type ShareShop,
} from "./share";
import { shopIconPng } from "./icon.server";

const shop: ShareShop = {
  slug: "didaktika",
  name: "Дидактические материалы",
  tagline: "Материалы  для <b>педагогов</b>",
  accent: "#ff0066",
  origin: "https://www.frogflow.tech",
  cover: "/api/img/bot/abc",
};

const tag = (meta: ReturnType<typeof shopMeta>, key: string) =>
  meta.find((m) => ("property" in m ? m.property : "name" in m ? m.name : "") === key) as
    { content: string } | undefined;

describe("превью ссылки на витрину", () => {
  it("абсолютные адрес и картинка, описание без тегов", () => {
    const m = shopMeta(shop);
    expect(m[0]).toEqual({ title: shop.name });
    expect(tag(m, "og:url")?.content).toBe("https://www.frogflow.tech/s/didaktika");
    expect(tag(m, "og:image")?.content).toBe("https://www.frogflow.tech/api/img/bot/abc");
    expect(tag(m, "og:description")?.content).toBe("Материалы для педагогов");
    expect(tag(m, "og:type")?.content).toBe("website");
    expect(tag(m, "twitter:card")?.content).toBe("summary_large_image");
    expect(tag(m, "theme-color")?.content).toBe("#ff0066");
  });

  it("без картинки и описания — без og:image и пустых тегов, цвет платформы", () => {
    const m = shopMeta({ ...shop, cover: null, tagline: null, accent: null });
    expect(tag(m, "og:image")).toBeUndefined();
    expect(tag(m, "og:description")).toBeUndefined();
    expect(tag(m, "description")).toBeUndefined();
    expect(tag(m, "twitter:card")?.content).toBe("summary");
    expect(tag(m, "theme-color")?.content).toBe("#16a34a");
  });

  it("товар: своё фото, иначе картинка магазина; название с магазином", () => {
    const p = { id: "p1", name: "Пазл", description: "x".repeat(500), images: ["/api/img/bot/p"] };
    const m = productMeta(p, shop);
    expect(m[0]).toEqual({ title: "Пазл — Дидактические материалы" });
    expect(tag(m, "og:image")?.content).toBe("https://www.frogflow.tech/api/img/bot/p");
    expect(tag(m, "og:url")?.content).toBe("https://www.frogflow.tech/s/didaktika/p/p1");
    expect(tag(m, "og:type")?.content).toBe("product");
    expect(tag(m, "og:description")!.content.length).toBeLessThanOrEqual(200);
    expect(tag(productMeta({ ...p, images: [] }, shop), "og:image")?.content).toBe(
      "https://www.frogflow.tech/api/img/bot/abc",
    );
  });

  it("без данных магазина — ни относительных картинок, ни пустого og:url", () => {
    const m = productMeta(
      { id: "p1", name: "Пазл", description: "", images: ["/api/img/x"] },
      null,
    );
    expect(tag(m, "og:image")).toBeUndefined();
    expect(tag(m, "og:url")).toBeUndefined();
  });

  it("absoluteUrl: только путь от корня или https", () => {
    expect(absoluteUrl("https://a.kz/", "/x")).toBe("https://a.kz/x");
    expect(absoluteUrl("https://a.kz", "https://cdn.kz/i.png")).toBe("https://cdn.kz/i.png");
    expect(absoluteUrl("https://a.kz", "//evil.kz/x")).toBeNull();
    expect(absoluteUrl("https://a.kz", "javascript:alert(1)")).toBeNull();
    expect(absoluteUrl("https://a.kz", null)).toBeNull();
  });

  it("shareText режет по слову и ставит многоточие", () => {
    const s = shareText("слово ".repeat(60), 50);
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s.endsWith("…")).toBe(true);
    expect(s).not.toMatch(/сло…$/);
  });
});

describe("установка витрины на телефон", () => {
  it("манифест: отдельное окно в пределах витрины, иконки в цвете магазина", () => {
    const m = shopManifest(shop);
    expect(m).toMatchObject({
      id: "/s/didaktika",
      start_url: "/s/didaktika",
      scope: "/s/didaktika",
      display: "standalone",
      theme_color: "#ff0066",
      short_name: "Дидактическ…",
    });
    expect(m.icons.map((i) => [i.src, i.sizes])).toEqual([
      ["/s/didaktika/icon/192", "192x192"],
      ["/s/didaktika/icon/512", "512x512"],
    ]);
    expect(shopLinks("didaktika")).toEqual([
      { rel: "icon", type: "image/png", href: "/s/didaktika/icon/192" },
      { rel: "manifest", href: "/s/didaktika/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/s/didaktika/icon/180" },
    ]);
  });

  it("короткое имя: целиком, первое слово или обрезка", () => {
    expect(shortName("Развивашка")).toBe("Развивашка");
    expect(shortName("Print KZ Art Studio")).toBe("Print");
    expect(shortName("Дидактические материалы").length).toBe(12);
  });

  it("иконка — настоящий PNG нужного размера: фон в цвете магазина, сумка белая", () => {
    const png = shopIconPng(192, "#ff0066");
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(192);
    expect(png.readUInt32BE(20)).toBe(192);
    const idat = png.indexOf("IDAT");
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    const px = (x: number, y: number) => [
      ...raw.subarray(y * (192 * 3 + 1) + 1 + x * 3).subarray(0, 3),
    ];
    expect(px(2, 2)).toEqual([0xff, 0x00, 0x66]);
    expect(px(96, 120)).toEqual([255, 255, 255]);
    // Неверный цвет — цвет платформы, не падение.
    const fallback = inflateSync(
      (() => {
        const p = shopIconPng(180, "red");
        const i = p.indexOf("IDAT");
        return p.subarray(i + 4, i + 4 + p.readUInt32BE(i - 4));
      })(),
    );
    expect([...fallback.subarray(1, 4)]).toEqual([0x16, 0xa3, 0x4a]);
  });
});
