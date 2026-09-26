import { describe, expect, it } from "vitest";
import { imagePath } from "@/core/catalog/image-url";
import { freshLibrary } from "./library";

const BOT = "00000000-0000-0000-0000-000000000001";
const entry = (productId: string | null, item: string, lang = "ru") => ({
  productId,
  orderNo: 7,
  item,
  name: `${item}.pdf`,
  url: "https://s/x",
  lang,
});

describe("«Мои материалы»: актуальный вид товара (Mini App v1)", () => {
  it("подставляет актуальное имя и обложку товара, язык файла сохраняет", () => {
    const [e] = freshLibrary(
      BOT,
      [entry("p1", "Старое имя", "kk")],
      [
        {
          id: "p1",
          name: "Новое имя",
          product_images: [
            { image_path: `${BOT}/b.jpg`, sort_order: 1 },
            { image_path: `${BOT}/a.jpg`, sort_order: 0 },
          ],
        },
      ],
    );
    expect(e).toMatchObject({ item: "Новое имя", lang: "kk", name: "Старое имя.pdf" });
    // Обложка — первая картинка по порядку продавца.
    expect(e!.cover).toBe(imagePath(BOT, `${BOT}/a.jpg`));
    expect(e).not.toHaveProperty("productId");
  });

  it("удалённый товар или позиция без товара — название из заказа, без обложки", () => {
    expect(freshLibrary(BOT, [entry("gone", "Из заказа"), entry(null, "Без товара")], [])).toEqual([
      expect.objectContaining({ item: "Из заказа", cover: null }),
      expect.objectContaining({ item: "Без товара", cover: null }),
    ]);
  });
});
