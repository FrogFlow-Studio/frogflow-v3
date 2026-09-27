import { describe, expect, it } from "vitest";
import { contentMatchesExt } from "./sniff";

const b = (...xs: number[]) => new Uint8Array(xs);
const text = (s: string) => new TextEncoder().encode(s);
const PK = b(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const OLE = b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00);
const EXE = b(0x4d, 0x5a, 0x90, 0x00, 0x03);

describe("файл проверяется по содержимому, а не по имени", () => {
  it("настоящие форматы проходят", () => {
    expect(contentMatchesExt("jpg", b(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(contentMatchesExt("JPEG", b(0xff, 0xd8, 0xff, 0xe1))).toBe(true);
    expect(contentMatchesExt("png", b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      true,
    );
    expect(contentMatchesExt("pdf", text("%PDF-1.7\n"))).toBe(true);
    for (const e of ["zip", "docx", "xlsx", "pptx"]) expect(contentMatchesExt(e, PK)).toBe(true);
    for (const e of ["doc", "xls", "ppt"]) expect(contentMatchesExt(e, OLE)).toBe(true);
    expect(contentMatchesExt("txt", text("Реквизиты: ИИН 123"))).toBe(true);
  });

  it("программа или страница под чужим расширением не проходит", () => {
    for (const e of ["pdf", "zip", "docx", "doc", "jpg", "png", "txt"])
      expect(contentMatchesExt(e, EXE)).toBe(false);
    const html = text("<!doctype html><script>alert(1)</script>");
    for (const e of ["pdf", "zip", "docx", "jpg", "png"])
      expect(contentMatchesExt(e, html)).toBe(false);
    // PDF под видом фото и фото под видом PDF.
    expect(contentMatchesExt("jpg", text("%PDF-1.4"))).toBe(false);
    expect(contentMatchesExt("pdf", b(0xff, 0xd8, 0xff))).toBe(false);
  });

  it("текст — только UTF-8 без нулевых байтов", () => {
    expect(contentMatchesExt("txt", b(0x41, 0x00, 0x42))).toBe(false);
    expect(contentMatchesExt("txt", b(0xff, 0xfe, 0x41))).toBe(false);
    expect(contentMatchesExt("txt", new Uint8Array())).toBe(false);
  });

  it("короткий файл и незнакомое расширение — нет", () => {
    expect(contentMatchesExt("png", b(0x89, 0x50))).toBe(false);
    expect(contentMatchesExt("exe", EXE)).toBe(false);
    expect(contentMatchesExt("html", text("<html>"))).toBe(false);
  });
});
