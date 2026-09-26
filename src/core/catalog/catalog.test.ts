import { describe, expect, it } from "vitest";
import { imageUrl } from "./catalog";
import { decodeImageKey, encodeImageKey } from "./image-url";
import type { TenantContext } from "@/core/tenant/resolve.server";

const ctx = {
  appUrl: "https://app.test",
  tenant: { id: "0bac1f86-5231-4e57-838d-2faa44d427e7" },
} as TenantContext;

describe("imageUrl", () => {
  it("ключ с префиксом и без него дают один адрес", () => {
    const a = imageUrl(ctx, "0bac1f86-5231-4e57-838d-2faa44d427e7/a.png");
    expect(a).toBe(
      `https://app.test/api/img/0bac1f86-5231-4e57-838d-2faa44d427e7/${encodeImageKey(ctx.tenant.id, "a.png")}`,
    );
    expect(decodeImageKey(a.split("/").pop()!)).toBe("a.png");
    expect(decodeImageKey(imageUrl(ctx, "1783414427610-x7i24b.jpeg").split("/").pop()!)).toBe(
      "1783414427610-x7i24b.jpeg",
    );
    expect(a).not.toMatch(/\.png$/);
    expect(decodeImageKey("../x")).toBeNull();
  });

  it("закодированный выход из каталога не декодируется в ключ", () => {
    const enc = (s: string) => encodeImageKey("x", s);
    expect(decodeImageKey(enc("%2e%2e/%2e%2e/rest/v1/bots"))).toBeNull();
    expect(decodeImageKey(enc("../other/a.png"))).toBeNull();
    expect(decodeImageKey(enc("a.png?select=*"))).toBeNull();
    expect(decodeImageKey(enc("a\\..\\b"))).toBeNull();
  });
});
