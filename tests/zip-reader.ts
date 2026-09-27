import { crc32, inflateRawSync } from "node:zlib";

/** Чтение ZIP для тестов: по центральному каталогу, со сверкой CRC. */
export function readZip(buf: Buffer): Array<{ name: string; data: Buffer }> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("нет конца каталога");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: Array<{ name: string; data: Buffer }> = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("битый каталог");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataAt = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const packed = buf.subarray(dataAt, dataAt + size);
    const data = method === 8 ? inflateRawSync(packed) : Buffer.from(packed);
    if (crc32(data) !== crc) throw new Error(`CRC ${name}`);
    out.push({ name, data });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
