import { describe, expect, it } from "vitest";
import type { Database } from "@/core/db-types";
import {
  downloadFileName,
  itemLanguages,
  itemMaterials,
  materialDownloadName,
  withDownloadName,
} from "./pure";

type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];
// Как строка из базы: пустые колонки снимка — null, а не отсутствуют.
const item = (o: Partial<OrderItemRow>) =>
  ({
    material_files_by_lang: null,
    material_files_snapshot: [],
    material_files_kz_snapshot: [],
    file_path_snapshot: null,
    file_name_snapshot: null,
    file_url_snapshot: null,
    file_path_kz_snapshot: null,
    file_name_kz_snapshot: null,
    file_url_kz_snapshot: null,
    ...o,
  }) as OrderItemRow;

describe("itemMaterials: откаты снимка заказа", () => {
  it("откатывается на старые ru/kk снимки, если карты по языкам нет", () => {
    // Заказ до MIGRATION-37: несколько файлов лежат в material_files_*_snapshot,
    // одиночные колонки — только первый файл.
    const old = item({
      material_files_by_lang: {},
      material_files_snapshot: [
        { path: "r1.pdf", name: "R1", url: null },
        { path: "r2.pdf", name: "R2", url: null },
      ],
      material_files_kz_snapshot: [
        { path: "k1.pdf", name: "K1", url: null },
        { path: "k2.pdf", name: "K2", url: null },
      ],
      file_path_snapshot: "r1.pdf",
      file_name_snapshot: "R1",
      file_path_kz_snapshot: "k1.pdf",
    });
    expect(itemMaterials(old, "ru").map((m) => m.path)).toEqual(["r1.pdf", "r2.pdf"]);
    expect(itemMaterials(old, "kk").map((m) => m.path)).toEqual(["k1.pdf", "k2.pdf"]);
    expect(itemLanguages(old)).toEqual(["ru", "kk"]);
  });

  it("карта по языкам важнее старых снимков", () => {
    const both = item({
      material_files_by_lang: { ru: [{ path: "new.pdf", name: "N", url: null }] },
      material_files_snapshot: [{ path: "old.pdf", name: "O", url: null }],
    });
    expect(itemMaterials(both, "ru").map((m) => m.path)).toEqual(["new.pdf"]);
  });

  it("мусор в старом снимке не выдаётся", () => {
    const junk = item({
      material_files_snapshot: [null, "x", { name: "без пути" }, { path: "ok.pdf" }] as never,
    });
    expect(itemMaterials(junk, "ru")).toEqual([{ path: "ok.pdf", name: null, url: null }]);
  });

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

describe("человеческое имя файла при выдаче", () => {
  it("дописывает расширение из storagePath к человеческому имени", () => {
    expect(downloadFileName("Пазлы БУКВЫ", "t/1782643012614-ni1xub.pdf")).toBe("Пазлы БУКВЫ.pdf");
  });

  it("не дублирует расширение, если оно уже есть в имени", () => {
    expect(downloadFileName("Пазлы.PDF", "t/1782643012614-ni1xub.pdf")).toBe("Пазлы.PDF");
  });

  it("заменяет запрещённые в именах файлов символы на пробел", () => {
    expect(downloadFileName('A\\B/C:D*E?F"G<H>I|', "x.pdf")).toBe("A B C D E F G H I.pdf");
  });

  it("схлопывает повторные пробелы и обрезает края", () => {
    expect(downloadFileName("   Пазлы    БУКВЫ  ", "x.zip")).toBe("Пазлы БУКВЫ.zip");
  });

  it("обрезает слишком длинное имя до 80 символов основы", () => {
    const name = downloadFileName("а".repeat(200), "x.pdf");
    expect(name).toBe(`${"а".repeat(80)}.pdf`);
  });

  it("подставляет запасное имя, если после очистки ничего не осталось", () => {
    expect(downloadFileName(' /:*?"<>| ', "x.pdf")).toBe("Материал.pdf");
  });

  it("без расширения в пути хранилища возвращает имя как есть", () => {
    expect(downloadFileName("Пазлы", "t/file")).toBe("Пазлы");
  });

  it("имя материала, иначе имя товара, иначе «Материал»", () => {
    const path = "t/1782643012614-ni1xub.pdf";
    expect(materialDownloadName({ path, name: "Буквы" }, "Пазлы")).toBe("Буквы.pdf");
    expect(materialDownloadName({ path, name: null }, "Пазлы")).toBe("Пазлы.pdf");
    expect(materialDownloadName({ path, name: "" }, "")).toBe("Материал.pdf");
  });

  it("кириллица с кавычками и пробелами кодируется в ссылке один раз", () => {
    const signed = "https://x.supabase.co/storage/v1/object/sign/product-files/t/1.pdf?token=abc";
    const name = "Пазлы «Буквы» 1 класс.pdf";
    const url = withDownloadName(signed, name);
    expect(url.startsWith(`${signed}&download=`)).toBe(true);
    const param = new URL(url).searchParams.get("download");
    // Хранилище берёт имя из параметра как есть — после одного раскодирования.
    expect(param).toBe(name);
    expect(url).not.toContain("%25");
    expect(withDownloadName("https://x/a.pdf", "a b.pdf")).toBe(
      "https://x/a.pdf?download=a%20b.pdf",
    );
  });

  it("несколько файлов без своего имени нумеруются, с именем — остаются как есть", () => {
    const a = { path: "t/1.pdf", name: null, url: null };
    const b = { path: "t/2.pdf", name: "", url: null };
    const c = { path: "t/3.zip", name: "Ответы", url: null };
    const all = [a, b, c];
    expect(materialDownloadName(a, "Пазлы", all)).toBe("Пазлы (1).pdf");
    expect(materialDownloadName(b, "Пазлы", all)).toBe("Пазлы (2).pdf");
    expect(materialDownloadName(c, "Пазлы", all)).toBe("Ответы.zip");
    // Один файл без имени — без номера.
    expect(materialDownloadName(a, "Пазлы", [a, c])).toBe("Пазлы.pdf");
  });
});
