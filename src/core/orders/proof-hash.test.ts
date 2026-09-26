import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { proofContent, proofHashes } from "./proof-hash";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const cat = (...parts: Array<number[] | Uint8Array | string>) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : [...p])),
  );

/** Настоящий по разметке JPEG: SOI, APP0, SOS с данными (FF 00, рестарт), EOI. */
const JPEG = cat(
  [0xff, 0xd8],
  [0xff, 0xe0, 0x00, 0x04, 0xaa, 0xbb],
  [0xff, 0xda, 0x00, 0x03, 0x01],
  [0x10, 0xff, 0x00, 0x20, 0xff, 0xd0, 0x30],
  [0xff, 0xd9],
);
const pngChunk = (type: string, data: number[]) =>
  cat([0, 0, 0, data.length], type, data, [1, 2, 3, 4]);
const PNG = cat(
  [0x89],
  "PNG\r\n\x1a\n",
  pngChunk("IHDR", [1, 2, 3]),
  pngChunk("IDAT", [9]),
  pngChunk("IEND", []),
);
const PDF = cat("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF");

describe("отпечаток чека", () => {
  it("у чистого файла отпечаток совпадает с прежним хэшем сырых байтов", () => {
    for (const f of [JPEG, PNG, PDF]) {
      expect(proofContent(f)).toEqual(f);
      expect(proofHashes(f)).toEqual({ stored: sha(f), all: [sha(f)] });
    }
  });

  it("мусор перед %PDF и после %%EOF не меняет отпечаток", () => {
    const tampered = cat("junk junk\n", PDF, "\n%%EOF extra %%EOF\n");
    expect(proofHashes(tampered).stored).toBe(sha(PDF));
  });

  it("байты после конца JPEG не меняют отпечаток, даже с FF D9 в хвосте", () => {
    const tampered = cat(JPEG, [0x00, 0xff, 0xd9, 0x42, 0xff, 0xd9]);
    expect(proofHashes(tampered).stored).toBe(sha(JPEG));
  });

  it("байты после IEND у PNG не меняют отпечаток", () => {
    expect(proofHashes(cat(PNG, "tail IEND")).stored).toBe(sha(PNG));
  });

  it("старый чек с мусором, записанный хэшем сырых байтов, тоже узнаётся", () => {
    const tampered = cat("x", PDF);
    expect(proofHashes(tampered).all).toEqual([sha(PDF), sha(tampered)]);
  });

  it("битый JPEG без конца — отпечаток по всему файлу", () => {
    const broken = cat([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(proofContent(broken)).toEqual(broken);
  });
});
