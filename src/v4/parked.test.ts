import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { servedByWritable } from "./core/served-by";

const FILES = [
  "src/v4/channels/adapt.ts",
  "src/v4/channels/dispatch.server.ts",
  "src/v4/channels/gateway.server.ts",
  "src/v4/channels/buyer.ts",
  "src/v4/core/depth.ts",
  "src/v4/transfer/shop-carry.ts",
];

describe("отложенное до отдельного да", () => {
  it("каналы и шлюзы не зовут живую модель и не пишут флаг v4", () => {
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("anthropic.server");
      expect(src, f).not.toContain("speech.server");
      expect(src, f).not.toMatch(/served_by\s*[:=]\s*["']v4["']/);
    }
  });

  it("расписание Vercel без крона v4, ветка v4 не собирается, флаг не записывается", () => {
    const vercel = readFileSync("vercel.json", "utf8");
    expect(vercel).not.toContain("/api/v4/cron");
    expect(vercel).toContain('"v4": false');
    expect(servedByWritable("v4")).toBe(false);
    expect(servedByWritable("v2")).toBe(true);
    const bots = readFileSync("src/routes/api/operator/bots.ts", "utf8");
    expect(bots).toContain('z.enum(["v1", "v2"])');
    const clients = readFileSync("src/app/operator/clients.functions.ts", "utf8");
    expect(clients).toContain('z.enum(["v1", "v2"])');
  });

  it("вебхук v4 спит впереди ветки v2 и не занимает заявку v3", () => {
    const tg = readFileSync("src/routes/api/telegram.$botId.ts", "utf8");
    const v4At = tg.indexOf("dispatchV4Telegram");
    const claimAt = tg.indexOf("claimTelegramUpdate");
    expect(v4At).toBeGreaterThan(-1);
    expect(v4At).toBeLessThan(claimAt);
    expect(readFileSync("src/channels/zernio/intake.server.ts", "utf8")).toContain(
      "dispatchV4Zernio",
    );
    for (const f of [
      "src/routes/api/stripe.$botId.ts",
      "src/routes/api/kaspi.$botId.ts",
      "src/routes/api/nowpayments.$botId.ts",
      "src/routes/api/prodamus.$botId.ts",
      "src/routes/api/robokassa.$botId.$action.ts",
    ]) {
      expect(readFileSync(f, "utf8"), f).toContain("handleV4Gateway");
    }
  });
});
