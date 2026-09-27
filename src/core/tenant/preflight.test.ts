import { describe, expect, it } from "vitest";
import { evaluatePreflight, preflightBlockers, releasesTelegramOnSwitch } from "./preflight";

const base = {
  modulesOn: ["shop", "coupons"] as const,
  tokenPresent: true,
  tokenOk: true,
  botUsername: "demo_bot",
  paymentMethods: 2,
  products: 10,
  adminLogin: true,
  appUrl: "https://client.vercel.app",
};

describe("evaluatePreflight", () => {
  it("всё на месте — готов, с напоминанием про крон v1", () => {
    const p = evaluatePreflight({ ...base, modulesOn: [...base.modulesOn] });
    expect(p.ready).toBe(true);
    expect(p.checks.map((c) => [c.key, c.level])).toEqual([
      ["modules", "ok"],
      ["token", "ok"],
      ["payments", "ok"],
      ["products", "ok"],
      ["admin", "ok"],
      ["v1", "info"],
    ]);
    expect(p.checks[1]!.title).toContain("@demo_bot");
  });
  it("не перенесённый модуль и отсутствие токена блокируют переезд", () => {
    const p = evaluatePreflight({
      ...base,
      modulesOn: ["shop", "crypto"],
      tokenPresent: false,
      tokenOk: null,
    });
    expect(p.ready).toBe(false);
    expect(preflightBlockers(p)).toEqual(["Не все модули перенесены", "Нет токена бота"]);
  });
  it("отклонённый токен, пустые реквизиты и нет логина продавца блокируют; нет товаров — предупреждение", () => {
    const p = evaluatePreflight({
      ...base,
      modulesOn: ["shop"],
      tokenOk: false,
      paymentMethods: 0,
      products: 0,
      adminLogin: false,
      appUrl: null,
    });
    // Без реквизитов цифровой заказ не оформить; без логина продавец после
    // паузы проекта v1 остаётся без админки.
    expect(preflightBlockers(p)).toEqual([
      "Токен не отвечает",
      "Нет реквизитов оплаты",
      "Нет логина продавца",
    ]);
    expect(p.checks.filter((c) => c.level === "warn").map((c) => c.key)).toEqual(["products"]);
    expect(p.checks.some((c) => c.key === "v1")).toBe(false);
  });
  it("Robokassa считается настроенной оплатой без реквизитов", () => {
    const p = evaluatePreflight({ ...base, modulesOn: ["shop", "robokassa"], paymentMethods: 0 });
    expect(p.checks.find((c) => c.key === "payments")?.level).toBe("ok");
  });
  it("напоминание про v1: его крон возвращает вебхук каждую минуту", () => {
    const p = evaluatePreflight({ ...base, modulesOn: ["shop"] });
    expect(p.checks.find((c) => c.key === "v1")?.detail).toMatch(/каждую минуту/);
  });

  it("некому подтверждать заказы и выдача в процессе блокируют переезд", () => {
    const p = evaluatePreflight({
      ...base,
      modulesOn: ["shop"],
      sellerChats: 0,
      deliveringOrders: 2,
    });
    expect(preflightBlockers(p)).toEqual([
      "Некому подтверждать заказы",
      "Идёт выдача заказов в v1",
    ]);
  });

  it("цифровые товары без файлов и нет короткого адреса — предупреждения", () => {
    const p = evaluatePreflight({
      ...base,
      modulesOn: ["shop"],
      sellerChats: 1,
      deliveringOrders: 0,
      unsellableProducts: 3,
      slug: null,
    });
    expect(p.ready).toBe(true);
    const warn = p.checks.filter((c) => c.level === "warn");
    expect(warn.map((c) => c.key)).toEqual(["files", "slug"]);
    expect(warn[0]!.detail).toContain("3");
  });

  it("просроченная подписка с политикой «приостановить» блокирует: первый же крон выключит бота", () => {
    const blocked = evaluatePreflight({
      ...base,
      modulesOn: ["shop"],
      subscription: { state: "grace_over", suspend: true },
    });
    expect(preflightBlockers(blocked)).toEqual(["Подписка просрочена"]);
    const warned = evaluatePreflight({
      ...base,
      modulesOn: ["shop"],
      subscription: { state: "grace_over", suspend: false },
    });
    expect(warned.ready).toBe(true);
    expect(warned.checks.find((c) => c.key === "subscription")?.level).toBe("warn");
  });

  it("аккаунт Zernio у двух клиентов блокирует переезд", () => {
    const p = evaluatePreflight({ ...base, modulesOn: ["shop"], zernioConflicts: ["ig-1"] });
    expect(preflightBlockers(p)).toEqual(["Аккаунт Zernio числится у двух клиентов"]);
  });
});

describe("evaluatePreflight: что блокирует клиента с Instagram и WhatsApp", () => {
  const shop = { ...base, modulesOn: ["shop"] as ["shop"] };

  it("заказы из Instagram или WhatsApp за 30 дней без аккаунтов Zernio — блок", () => {
    const p = evaluatePreflight({ ...shop, channelOrders30d: 12, zernioAccounts: 0 });
    expect(preflightBlockers(p)).toEqual(["Instagram и WhatsApp не подключены"]);
    expect(p.checks.find((c) => c.key === "zernio_accounts")!.detail).toContain("12");
  });

  it("аккаунты есть или заказов из каналов нет — не блок", () => {
    for (const i of [
      { channelOrders30d: 12, zernioAccounts: 1 },
      { channelOrders30d: 0, zernioAccounts: 0 },
    ]) {
      const p = evaluatePreflight({ ...shop, ...i });
      expect(p.checks.find((c) => c.key === "zernio_accounts")).toBeUndefined();
      expect(p.ready).toBe(true);
    }
  });

  it("почта платформы не настроена, а клиенту она нужна — предупреждение", () => {
    const p = evaluatePreflight({ ...shop, mail: { configured: false, needed: true } });
    expect(p.ready).toBe(true);
    expect(p.checks.find((c) => c.key === "mail")?.level).toBe("warn");
    for (const mail of [
      { configured: true, needed: true },
      { configured: false, needed: false },
    ])
      expect(evaluatePreflight({ ...shop, mail }).checks.find((c) => c.key === "mail")).toBe(
        undefined,
      );
  });

  it("сторис-теги v1: v2 пуст — перенесутся при переключении; перенесены не все — предупреждение", () => {
    const pending = evaluatePreflight({ ...shop, storyTags: { v1: 40, v2: 0, max: 200 } });
    expect(pending.checks.find((c) => c.key === "story_tags")?.level).toBe("info");
    const partial = evaluatePreflight({ ...shop, storyTags: { v1: 40, v2: 10, max: 200 } });
    expect(partial.checks.find((c) => c.key === "story_tags")?.level).toBe("warn");
    expect(partial.checks.find((c) => c.key === "story_tags")!.detail).toContain("30");
    const over = evaluatePreflight({ ...shop, storyTags: { v1: 250, v2: 0, max: 200 } });
    expect(over.checks.find((c) => c.key === "story_tags")?.level).toBe("warn");
    expect(over.checks.find((c) => c.key === "story_tags")!.detail).toContain("200");
    // v2 заполнен до предела, но 50 тегов v1 всё равно не поместились.
    const full = evaluatePreflight({ ...shop, storyTags: { v1: 250, v2: 200, max: 200 } });
    expect(full.checks.find((c) => c.key === "story_tags")?.level).toBe("warn");
    for (const storyTags of [
      { v1: 40, v2: 40, max: 200 },
      { v1: 0, v2: 0, max: 200 },
    ])
      expect(
        evaluatePreflight({ ...shop, storyTags }).checks.find((c) => c.key === "story_tags"),
      ).toBeUndefined();
  });
});

describe("releasesTelegramOnSwitch", () => {
  it("сбрасывает меню бота только при настоящем откате с v2", () => {
    expect(releasesTelegramOnSwitch("v2", "v1")).toBe(true);
    // Клиент и так на v1 (или ни разу не был на v2) — его живой бот не трогаем.
    expect(releasesTelegramOnSwitch("v1", "v1")).toBe(false);
    expect(releasesTelegramOnSwitch(undefined, "v1")).toBe(false);
    expect(releasesTelegramOnSwitch(null, "v1")).toBe(false);
    expect(releasesTelegramOnSwitch("v2", "v2")).toBe(false);
    expect(releasesTelegramOnSwitch("v1", "v2")).toBe(false);
  });
});
