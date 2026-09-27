import { describe, expect, it } from "vitest";
import { isIssuedUploadKey, newUploadKey, uploadExt, uploadProblem } from "./upload";

const T = "11111111-2222-3333-4444-555555555555";
const HEX = "0123456789abcdef01234567";
const MB = 1024 * 1024;

describe("uploadProblem", () => {
  it("картинка: до 20 МБ, только JPEG/PNG/GIF/WebP", () => {
    expect(uploadProblem("image", 5 * MB, "image/png")).toBeNull();
    expect(uploadProblem("image", 21 * MB, "image/png")).toBe("too_big");
    expect(uploadProblem("image", MB, "image/svg+xml")).toBe("bad_type");
    expect(uploadProblem("image", MB, "text/html")).toBe("bad_type");
  });

  it("файл: до 200 МБ любого типа, то есть больше лимита Vercel в 4,5 МБ", () => {
    expect(uploadProblem("file", 150 * MB, "video/mp4")).toBeNull();
    expect(uploadProblem("file", 201 * MB, "application/zip")).toBe("too_big");
  });

  it("фото в чат: JPEG или PNG до 5 МБ — общий предел Telegram, Instagram и WhatsApp", () => {
    expect(uploadProblem("chatPhoto", 4 * MB, "image/jpeg", "фото.JPG")).toBeNull();
    expect(uploadProblem("chatPhoto", 4 * MB, "image/png", `${T}/${HEX}.png`)).toBeNull();
    expect(uploadProblem("chatPhoto", 6 * MB, "image/jpeg", "a.jpg")).toBe("too_big");
    // WebP и GIF WhatsApp фото не примет.
    expect(uploadProblem("chatPhoto", MB, "image/webp", "a.webp")).toBe("bad_type");
    expect(uploadProblem("chatPhoto", MB, "image/gif", "a.gif")).toBe("bad_type");
    // Тип картинки, а расширение — страница: не пропускаем.
    expect(uploadProblem("chatPhoto", MB, "image/png", "a.html")).toBe("bad_type");
  });

  it("файл в чат: документы до 20 МБ по списку расширений", () => {
    expect(uploadProblem("chatFile", 19 * MB, "application/pdf", "Прайс.pdf")).toBeNull();
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(uploadProblem("chatFile", MB, docx, "договор.docx")).toBeNull();
    // Браузер не знает тип — решает расширение.
    expect(uploadProblem("chatFile", MB, "application/octet-stream", "смета.xlsx")).toBeNull();
    expect(uploadProblem("chatFile", 21 * MB, "application/pdf", "a.pdf")).toBe("too_big");
    expect(uploadProblem("chatFile", MB, "application/octet-stream", "setup.exe")).toBe("bad_type");
    expect(uploadProblem("chatFile", MB, "text/html", "a.txt")).toBe("bad_type");
    expect(uploadProblem("chatFile", MB, "application/pdf", "a.html")).toBe("bad_type");
    expect(uploadProblem("chatFile", MB, "video/mp4", "a.mp4")).toBe("bad_type");
  });

  it("пустой или непонятный размер не пропускает", () => {
    expect(uploadProblem("file", 0, "application/pdf")).toBe("empty");
    expect(uploadProblem("file", Number.NaN, "application/pdf")).toBe("empty");
  });
});

describe("ключи загрузки", () => {
  it("расширение чистится, без него — bin", () => {
    expect(uploadExt("Урок 1.PDF")).toBe("pdf");
    expect(uploadExt("x.../../..%2e")).toBe("2e");
    expect(uploadExt("README")).toBe("bin");
  });

  it("новый ключ лежит под префиксом клиента и проходит подтверждение", () => {
    const key = newUploadKey(T, HEX, "video.MOV");
    expect(key).toBe(`${T}/${HEX}.mov`);
    expect(isIssuedUploadKey(T, key)).toBe(true);
  });

  it("подтверждение не принимает чужие, старые и кривые ключи", () => {
    const other = "99999999-2222-3333-4444-555555555555";
    expect(isIssuedUploadKey(T, `${other}/${HEX}.png`)).toBe(false);
    expect(isIssuedUploadKey(T, `${T}/old-photo.png`)).toBe(false);
    expect(isIssuedUploadKey(T, `${T}/${HEX}/x.png`)).toBe(false);
    expect(isIssuedUploadKey(T, `${T}/../${other}/${HEX}.png`)).toBe(false);
  });
});
