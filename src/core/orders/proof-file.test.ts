import { describe, expect, it } from "vitest";
import { MAX_PROOF_BYTES, validateProofFile } from "./proof-file";

const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pdf = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const webp = () => new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
const heic = () => new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")]);

describe("файл чека", () => {
  it("accepts jpeg/png/pdf with matching magic bytes", () => {
    expect(validateProofFile({ bytes: jpeg(), mime: "image/jpeg" })).toEqual({
      ok: true,
      mime: "image/jpeg",
      ext: "jpg",
    });
    expect(validateProofFile({ bytes: png(), mime: "image/png" })).toEqual({
      ok: true,
      mime: "image/png",
      ext: "png",
    });
    expect(validateProofFile({ bytes: pdf(), mime: "application/pdf; charset=binary" })).toEqual({
      ok: true,
      mime: "application/pdf",
      ext: "pdf",
    });
    expect(validateProofFile({ bytes: webp(), mime: "image/webp" }).ok).toBe(true);
    expect(validateProofFile({ bytes: heic(), mime: "image/heic" }).ok).toBe(true);
  });

  it("rejects empty files, spoofed mime types and oversized payloads", () => {
    expect(validateProofFile({ bytes: new Uint8Array(), mime: "image/jpeg" })).toEqual({
      ok: false,
      reason: "invalid_file",
    });
    // Подменённый тип не спасает не-картинку: решает содержимое.
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(validateProofFile({ bytes: html, mime: "application/pdf" })).toEqual({
      ok: false,
      reason: "invalid_file",
    });
    const huge = new Uint8Array(MAX_PROOF_BYTES + 1);
    huge.set(jpeg());
    expect(validateProofFile({ bytes: huge, mime: "image/jpeg" })).toEqual({
      ok: false,
      reason: "file_too_large",
    });
  });

  it("тип без подробностей (Telegram отдаёт octet-stream) — по содержимому", () => {
    expect(validateProofFile({ bytes: pdf(), mime: "application/octet-stream" })).toEqual({
      ok: true,
      mime: "application/pdf",
      ext: "pdf",
    });
    expect(validateProofFile({ bytes: jpeg(), mime: "" })).toMatchObject({ ext: "jpg" });
  });

  it("не картинка и не PDF — отказ, как бы ни назывался тип", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(validateProofFile({ bytes: html, mime: "image/jpeg" }).ok).toBe(false);
    expect(validateProofFile({ bytes: html, mime: "application/octet-stream" }).ok).toBe(false);
    expect(validateProofFile({ bytes: new Uint8Array(20).fill(1), mime: "text/plain" }).ok).toBe(
      false,
    );
  });

  it("настоящее фото с неточным заявленным типом (CDN Instagram) принимается по содержимому", () => {
    expect(validateProofFile({ bytes: webp(), mime: "image/jpeg" })).toEqual({
      ok: true,
      mime: "image/webp",
      ext: "webp",
    });
    expect(validateProofFile({ bytes: jpeg(), mime: "application/pdf" })).toEqual({
      ok: true,
      mime: "image/jpeg",
      ext: "jpg",
    });
  });

  it("видео MP4/MOV с меткой ftyp — не HEIC", () => {
    const box = (brand: string) =>
      new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode(`ftyp${brand}`)]);
    for (const brand of ["isom", "mp42", "qt  ", "avc1", "M4V "])
      expect(validateProofFile({ bytes: box(brand), mime: "application/octet-stream" }).ok).toBe(
        false,
      );
    for (const brand of ["heic", "heix", "mif1", "msf1"])
      expect(validateProofFile({ bytes: box(brand), mime: "application/octet-stream" })).toEqual({
        ok: true,
        mime: "image/heic",
        ext: "heic",
      });
  });

  it("PDF с мусором перед %PDF (до 1024 байт) принимается, дальше — нет", () => {
    const withPrefix = (n: number) => {
      const b = new Uint8Array(n + 8);
      b.fill(0x20, 0, n);
      b.set(new TextEncoder().encode("%PDF-1.7"), n);
      return b;
    };
    expect(validateProofFile({ bytes: withPrefix(3), mime: "application/pdf" })).toEqual({
      ok: true,
      mime: "application/pdf",
      ext: "pdf",
    });
    // Метка целиком в первых 1024 байтах — как у Acrobat.
    expect(validateProofFile({ bytes: withPrefix(1020), mime: "application/pdf" }).ok).toBe(true);
    expect(validateProofFile({ bytes: withPrefix(1021), mime: "application/pdf" }).ok).toBe(false);
  });

  it("AVIF принимается как image/avif, а не как HEIC", () => {
    for (const brand of ["avif", "avis"]) {
      const b = new Uint8Array([0, 0, 0, 0x1c, ...new TextEncoder().encode(`ftyp${brand}`)]);
      expect(validateProofFile({ bytes: b, mime: "application/octet-stream" })).toEqual({
        ok: true,
        mime: "image/avif",
        ext: "avif",
      });
    }
  });
});
