import { describe, expect, it } from "vitest";
import { isPrivateAddress, parseCrm, resolvesPublic, safeWebhookUrl, signBody } from "./webhook";

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
  it("внутренние адреса в любой записи отклоняются", () => {
    for (const u of [
      "https://2130706433/", // 127.0.0.1 десятичным числом
      "https://0x7f.1/",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:a9fe:a9fe]/", // 169.254.169.254
      "https://[fd00::1]/",
      "https://[fe80::1]/",
      "https://100.64.0.1/",
      "https://0.0.0.0/",
      "https://app.localhost/",
    ])
      expect(safeWebhookUrl(u), u).toBe(false);
    expect(safeWebhookUrl("https://[2a00:1450:4001::200e]/hook")).toBe(true);
    expect(safeWebhookUrl("https://8.8.8.8/hook")).toBe(true);
  });
  it("isPrivateAddress: публичные — нет, служебные — да", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2a00:1450:4001::200e")).toBe(false);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
  });
  it("имя, которое резолвится во внутренний адрес, не пропускается", async () => {
    expect(await resolvesPublic("localhost")).toBe(false);
    expect(await resolvesPublic("127.0.0.1")).toBe(false);
    expect(await resolvesPublic("[::1]")).toBe(false);
  });
});
