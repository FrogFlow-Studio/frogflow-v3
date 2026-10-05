import { describe, expect, it } from "vitest";
import { getPinned } from "./import-photo.server";

/** Ссылку на фото пишет продавец: во внутреннюю сеть и не по https сервер не ходит (запрос даже не стартует). */
describe("getPinned: защита от SSRF", () => {
  for (const url of [
    "http://cdn.example/a.jpg",
    "https://localhost/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://10.0.0.5/a.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/a.jpg",
    "https://user:pass@cdn.example/a.jpg",
    "https://metadata.internal/a.jpg",
  ])
    it(`отказ: ${url}`, async () => {
      const r = await getPinned(url, 1000, 1024);
      expect(r.ok).toBe(false);
    });
});
