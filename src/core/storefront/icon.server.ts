/**
 * Иконка витрины для телефона: квадрат в цвете магазина с белой сумкой
 * посередине. PNG собираем сами (zlib из node), без графических библиотек:
 * одна функция на Vercel, лишние зависимости ни к чему. Сумка — в центральных
 * 60 %, так иконка не обрезается маской Android (purpose maskable).
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const body = Buffer.concat([head.subarray(4), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, crc]);
}

export function parseHex(hex: string | null | undefined): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Доля «сумки» в точке (x, y) единичного квадрата: 1 — белое, 0 — фон. */
function inBag(x: number, y: number): boolean {
  // Корпус: прямоугольник со скруглёнными углами.
  const [l, r, t, b, rad] = [0.3, 0.7, 0.42, 0.78, 0.05];
  if (x >= l && x <= r && y >= t && y <= b) {
    const cx = Math.min(Math.max(x, l + rad), r - rad);
    const cy = Math.min(Math.max(y, t + rad), b - rad);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  }
  // Ручка: верхняя половина кольца над корпусом.
  if (y <= t) {
    const d = Math.hypot(x - 0.5, y - t);
    return d <= 0.12 && d >= 0.08;
  }
  return false;
}

/** PNG size×size в цвете accent (#rrggbb); неверный цвет — цвет платформы. */
export function shopIconPng(size: number, accent: string | null): Buffer {
  const bg = parseHex(accent) ?? [0x16, 0xa3, 0x4a];
  const SS = 3; // сглаживание краёв: 3×3 пробы на пиксель
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  for (let py = 0; py < size; py++) {
    raw[py * row] = 0; // фильтр строки: None
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++)
          if (inBag((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)) hit++;
      const a = hit / (SS * SS);
      const o = py * row + 1 + px * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(bg[c]! * (1 - a) + 255 * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}
