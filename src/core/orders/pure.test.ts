import { describe, expect, it } from "vitest";
import type { Database } from "@/core/db-types";
import { itemLanguages, itemMaterials } from "./pure";

type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];
// Как строка из базы: пустые колонки снимка — null, а не отсутствуют.
const item = (o: Partial<OrderItemRow>) =>
  ({
    material_files_by_lang: null,
    file_path_snapshot: null,
    file_name_snapshot: null,
    file_url_snapshot: null,
    file_path_kz_snapshot: null,
    file_name_kz_snapshot: null,
    file_url_kz_snapshot: null,
    ...o,
  }) as OrderItemRow;

describe("itemMaterials: откаты снимка заказа", () => {
  it("откатывается на совсем старые одиночные *_snapshot-колонки", () => {
    expect(
      itemMaterials(item({ file_path_snapshot: "old.pdf", file_name_snapshot: "Old" }), "ru"),
    ).toEqual([{ path: "old.pdf", name: "Old", url: null }]);
    expect(
      itemMaterials(item({ file_path_kz_snapshot: "kz.pdf", file_name_kz_snapshot: "KZ" }), "kk"),
    ).toEqual([{ path: "kz.pdf", name: "KZ", url: null }]);
  });

  it("en/uz не имеют legacy-отката — пусто, если карты по языкам нет", () => {
    const old = item({ file_path_snapshot: "old.pdf", file_path_kz_snapshot: "kz.pdf" });
    expect(itemMaterials(old, "en")).toEqual([]);
    expect(itemMaterials(old, "uz")).toEqual([]);
  });
});

describe("itemLanguages", () => {
  it("языки идут по порядку ru→kk→en→uz, первый непустой — первый в списке", () => {
    const onlyUz = item({
      material_files_by_lang: { uz: [{ path: "u.pdf", name: null, url: null }] },
    });
    expect(itemLanguages(onlyUz)).toEqual(["uz"]);
    expect(itemMaterials(onlyUz, itemLanguages(onlyUz)[0]!)).toEqual([
      { path: "u.pdf", name: null, url: null },
    ]);
    const mixed = item({
      material_files_by_lang: {
        uz: [{ path: "u.pdf", name: null, url: null }],
        en: [{ path: "e.pdf", name: null, url: null }],
        kk: [{ path: "k.pdf", name: null, url: null }],
      },
    });
    expect(itemLanguages(mixed)).toEqual(["kk", "en", "uz"]);
  });

  it("пусто, если ни в одном языке ничего нет", () => {
    expect(itemLanguages(item({}))).toEqual([]);
    expect(itemLanguages(item({ material_files_by_lang: { ru: [] } }))).toEqual([]);
  });
});
