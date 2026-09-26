import { describe, expect, it } from "vitest";
import { productFiles } from "./product-files";

const product = {
  fulfillment_kind: "digital",
  product_material_files: [
    { language: "kk", file_path: "t/2.pdf", file_name: "Әріптер.pdf", sort_order: 0 },
    { language: "ru", file_path: "t/1.pdf", file_name: "Буквы.pdf", sort_order: 1 },
    { language: "ru", file_path: "t/0.pdf", file_name: "Обложка.pdf", sort_order: 0 },
  ],
};

describe("список файлов на странице товара (Mini App v1)", () => {
  it("название и язык каждого файла, по порядку продавца, без ключей хранилища", () => {
    expect(productFiles(product, true)).toEqual([
      { name: "Обложка.pdf", lang: "ru" },
      { name: "Буквы.pdf", lang: "ru" },
      { name: "Әріптер.pdf", lang: "kk" },
    ]);
    expect(JSON.stringify(productFiles(product, true))).not.toContain("t/");
  });

  it("без модуля языков — только русские файлы, как их и выдаст бот", () => {
    expect(productFiles(product, false).map((f) => f.lang)).toEqual(["ru", "ru"]);
  });

  it("старый товар с одиночным файлом v1 тоже в списке; физический — без списка", () => {
    expect(productFiles({ file_path: "t/old.pdf", file_name: "Прописи.pdf" }, false)).toEqual([
      { name: "Прописи.pdf", lang: "ru" },
    ]);
    expect(productFiles({ ...product, fulfillment_kind: "physical" }, true)).toEqual([]);
  });
});
