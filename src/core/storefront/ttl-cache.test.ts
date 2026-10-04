import { describe, expect, it } from "vitest";
import { createTtlCache } from "./ttl-cache";

describe("кеш каталога на 60 секунд", () => {
  it("отдаёт сохранённое до срока и забывает после", () => {
    let t = 1000;
    const c = createTtlCache<string>(60_000, () => t);
    c.set("a", "x");
    t += 59_999;
    expect(c.get("a")).toBe("x");
    t += 1;
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
  });
  it("ключи разных магазинов не смешиваются", () => {
    const c = createTtlCache<string>(60_000);
    c.set("shop1|{}", "один");
    expect(c.get("shop2|{}")).toBeUndefined();
  });
  it("не растёт без предела", () => {
    const c = createTtlCache<number>(60_000);
    for (let i = 0; i < 400; i++) c.set(`k${i}`, i);
    expect(c.size).toBe(300);
    expect(c.get("k0")).toBeUndefined();
    expect(c.get("k399")).toBe(399);
  });
});
