import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { isSafeStorageKey, isTenantStorageKey } from "@/core/storage/keys";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { isPdfMaterial, toPdfLatin, watermarkLine } from "./watermark";
import { protectMaterials, stampedKey, stampPdf } from "./watermark.server";

const T = "11111111-2222-3333-4444-555555555555";

describe("строка водяного знака", () => {
  it("кириллица и казахские буквы — латиницей, лишнее выпадает", () => {
    expect(toPdfLatin("Айгерім Жұмабаева")).toBe("Aygerim Zhumabaeva");
    expect(toPdfLatin("Щука 🐟 Ёлка")).toBe("Shchuka Elka");
  });

  it("имя, логин и номер заказа; без логина — почта, без всего — ID", () => {
    expect(watermarkLine({ display_name: "Мария", username: "maria_k" }, 57)).toBe(
      "Mariya · @maria_k · #57",
    );
    expect(watermarkLine({ display_name: null, customer_email: "a@b.kz" }, 3)).toBe("a@b.kz · #3");
    expect(watermarkLine({ telegram_id: 12345 }, 9)).toBe("ID 12345 · #9");
  });

  it("метим только PDF", () => {
    expect(isPdfMaterial({ path: "x/1.PDF", name: null })).toBe(true);
    expect(isPdfMaterial({ path: "x/1.bin", name: "Урок.pdf" })).toBe(true);
    expect(isPdfMaterial({ path: "x/1.zip", name: "Урок.zip" })).toBe(false);
  });
});

describe("копия со знаком", () => {
  it("ключ копии безопасен и лежит под префиксом клиента", () => {
    const key = stampedKey(T, 42, `${T}/abc.pdf`);
    expect(isSafeStorageKey(key)).toBe(true);
    expect(isTenantStorageKey(T, key)).toBe(true);
    expect(key).toBe(stampedKey(T, 42, `${T}/abc.pdf`));
    expect(key).not.toBe(stampedKey(T, 43, `${T}/abc.pdf`));
  });

  it("знак стоит на каждой странице, страниц столько же", async () => {
    const src = await PDFDocument.create();
    src.addPage([595, 842]);
    src.addPage([842, 595]);
    const out = await stampPdf(await src.save(), "Mariya · @maria_k · #57");
    const { totalPages, text } = await extractText(out, { mergePages: false });
    expect(totalPages).toBe(2);
    for (const page of text) expect(page).toContain("@maria_k");
  });

  it("у магазина без знака материалы уходят как есть, без походов в хранилище", async () => {
    const ctx = { tenant: { id: T, settings: {} } } as unknown as TenantContext;
    const mats = [{ path: `${T}/a.pdf`, name: "a.pdf", url: null }];
    expect(await protectMaterials(ctx, { id: 1 }, mats)).toBe(mats);
  });
});
