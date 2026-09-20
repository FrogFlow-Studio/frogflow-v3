import { describe, expect, it } from "vitest";
import { imageUrl } from "./catalog";
import type { TenantContext } from "@/core/tenant/resolve.server";

const ctx = {
  appUrl: "https://app.test",
  tenant: { id: "0bac1f86-5231-4e57-838d-2faa44d427e7" },
} as TenantContext;

describe("imageUrl", () => {
  it("ключ с префиксом и без него дают один адрес", () => {
    expect(imageUrl(ctx, "0bac1f86-5231-4e57-838d-2faa44d427e7/a.png")).toBe(
      "https://app.test/api/img/0bac1f86-5231-4e57-838d-2faa44d427e7/a.png",
    );
    expect(imageUrl(ctx, "1783414427610-x7i24b.jpeg")).toBe(
      "https://app.test/api/img/0bac1f86-5231-4e57-838d-2faa44d427e7/1783414427610-x7i24b.jpeg",
    );
  });
});
