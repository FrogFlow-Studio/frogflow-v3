import { describe, expect, it } from "vitest";
import { evaluatePreflight, preflightBlockers } from "./preflight";
import { vipPreflightChecks, withVipChecks, type VipPreflightInput } from "./preflight-vip";

/** Переезд клиента с VIP-ботом (DID 02): второй токен и группа проверяются до переключения. */
const ok: VipPreflightInput = {
  tokenPresent: true,
  tokenOk: true,
  username: "did_vip_bot",
  sameAsMain: false,
  groupSet: true,
  sellerChats: 1,
};

const base = evaluatePreflight({
  modulesOn: ["shop", "vip"],
  tokenPresent: true,
  tokenOk: true,
  botUsername: "did_bot",
  paymentMethods: 1,
  products: 3,
  adminLogin: true,
  appUrl: "https://did-v1.vercel.app",
});

const level = (v: Partial<VipPreflightInput>, key: string) =>
  vipPreflightChecks({ ...ok, ...v }).find((c) => c.key === key)?.level;

describe("предполётная проверка VIP-бота", () => {
  it("всё на месте — пункт «VIP-бот отвечает», переезд не блокируется", () => {
    const p = withVipChecks(base, ok);
    expect(p.ready).toBe(base.ready);
    expect(p.checks.find((c) => c.key === "vip_token")).toMatchObject({
      level: "ok",
      title: "VIP-бот отвечает — @did_vip_bot",
    });
  });

  it("модуль включён, а токена нет или getMe отказал — блокирует переезд", () => {
    expect(level({ tokenPresent: false, tokenOk: null }, "vip_token")).toBe("block");
    expect(level({ tokenOk: false }, "vip_token")).toBe("block");
    const p = withVipChecks(base, { ...ok, tokenPresent: false, tokenOk: null });
    expect(p.ready).toBe(false);
    expect(preflightBlockers(p)).toContain("Нет токена VIP-бота");
  });

  it("под VIP записан токен основного бота — блок", () => {
    expect(level({ sameAsMain: true }, "vip_token")).toBe("block");
  });

  it("нет VIP-группы — блок; некому подтверждать чеки — предупреждение", () => {
    expect(level({ groupSet: false }, "vip_group")).toBe("block");
    expect(level({ sellerChats: 0 }, "vip_chat")).toBe("warn");
    expect(level({}, "vip_group")).toBeUndefined();
    expect(level({}, "vip_chat")).toBeUndefined();
  });

  it("напоминание про v1 остаётся последним; без модуля VIP список не меняется", () => {
    const p = withVipChecks(base, { ...ok, groupSet: false });
    expect(p.checks.at(-1)!.key).toBe("v1");
    expect(p.checks.map((c) => c.key)).toContain("vip_group");
    expect(withVipChecks(base, null)).toBe(base);
  });
});
