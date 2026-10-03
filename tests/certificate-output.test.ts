import { describe, expect, it } from "vitest";
import {
  findCertificateChunk,
  missingLetters,
  pdfCodePoints,
} from "../scripts/certificate-output.ts";
import { certificatePdf } from "../src/core/courses/certificate-pdf.server";

// Проверка сборки (npm run verify) опирается на разбор PDF: тут она проверена на настоящем PDF.
const cert = {
  code: "CHECKCHECK",
  no: 1,
  orderItemId: "00000000-0000-4000-8000-000000000000",
  student: "Әйгерім Қасымова",
  course: "Основы акварели",
  issuedAt: "2026-10-03T10:00:00.000Z",
};
const opts = {
  locale: "kk",
  timezone: "Asia/Almaty",
  shop: "Школа",
  url: "https://s.test/c",
} as const;

describe("проверка сертификата в сборке", () => {
  it("в настоящем PDF находит глифы кириллицы и казахских букв", async () => {
    const pdf = await certificatePdf(cert, opts);
    const glyphs = pdfCodePoints(pdf);
    expect(glyphs.has("Ә".codePointAt(0)!)).toBe(true);
    expect(missingLetters(`${cert.student}${cert.course}`, glyphs)).toEqual([]);
  });

  it("буквы, которых нет в PDF, называет", async () => {
    const glyphs = pdfCodePoints(await certificatePdf(cert, opts));
    expect(
      missingLetters("Ко", new Set([...glyphs].filter((c) => c !== "К".codePointAt(0)!))),
    ).toEqual(["К"]);
    expect(missingLetters("Яблоко", new Set())).toContain("Я");
  });

  it("нет сборки — модуль не найден", () => {
    expect(findCertificateChunk(["/nonexistent-dir"])).toBeNull();
  });
});
