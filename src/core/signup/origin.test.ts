import { describe, expect, it } from "vitest";
import { signupOrigin, signupOriginLabel } from "./origin";

describe("откуда пришёл продавец", () => {
  it("принимает только строку сайта и известную страницу ниши", () => {
    expect(signupOrigin({ source: "site:google/spring", page: "cakes" })).toEqual({
      source: "site:google/spring",
      page: "cakes",
    });
    expect(signupOrigin({ source: "<script>", page: "admin" })).toBeNull();
    expect(signupOrigin({ source: "site:" + "a".repeat(80) })).toBeNull();
    expect(signupOrigin({ page: "courses" })).toEqual({ page: "courses" });
    expect(signupOrigin({})).toBeNull();
  });

  it("подпись для оператора", () => {
    expect(signupOriginLabel({ source: "site:google/spring ref-anna", page: "materials" })).toBe(
      "метка google/spring ref-anna · страница «для учебных материалов»",
    );
    expect(signupOriginLabel({ page: "cakes" })).toBe("страница «для кондитерских»");
    expect(signupOriginLabel(undefined)).toBeNull();
    // Руками испорченная запись в settings не показывается.
    expect(signupOriginLabel({ source: "p_x" } as never)).toBeNull();
  });
});
