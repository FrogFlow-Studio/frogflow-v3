import { describe, expect, it } from "vitest";
import { parseCrm, safeWebhookUrl, signBody } from "./webhook";

describe("вебхук в CRM", () => {
  it("только https и публичный хост", () => {
    expect(safeWebhookUrl("https://script.google.com/macros/s/X/exec")).toBe(true);
    expect(safeWebhookUrl("http://example.com/hook")).toBe(false);
    expect(safeWebhookUrl("https://localhost/hook")).toBe(false);
    expect(safeWebhookUrl("https://127.0.0.1/hook")).toBe(false);
    expect(safeWebhookUrl("https://10.1.2.3/hook")).toBe(false);
    expect(safeWebhookUrl("https://192.168.0.5/hook")).toBe(false);
    expect(safeWebhookUrl("https://172.20.0.1/hook")).toBe(false);
    expect(safeWebhookUrl("https://169.254.169.254/latest")).toBe(false);
    expect(safeWebhookUrl("https://user:pw@example.com/")).toBe(false);
    expect(safeWebhookUrl("not a url")).toBe(false);
  });
  it("настройки: небезопасный адрес — нет интеграции; неизвестные события отбрасываются", () => {
    expect(parseCrm(JSON.stringify({ url: "http://x.kz" }))).toBeNull();
    const c = parseCrm(JSON.stringify({ url: "https://x.kz/h", events: ["placed", "hack"] }));
    expect(c?.events).toEqual(["placed"]);
    expect(parseCrm(JSON.stringify({ url: "https://x.kz/h" }))?.events).toContain("delivered");
  });
  it("подпись HMAC-SHA256 тела", () => {
    expect(signBody("{}", "s")).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signBody("{}", "s")).not.toBe(signBody("{}", "t"));
  });
});
