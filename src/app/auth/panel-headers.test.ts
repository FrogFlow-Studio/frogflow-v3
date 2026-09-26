import { describe, expect, it } from "vitest";
import { PANEL_HEADERS } from "./panel-headers";

describe("заголовки панелей", () => {
  it("запрещают встраивание во фрейм и угадывание типа", () => {
    expect(PANEL_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(PANEL_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(PANEL_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
  });
});
