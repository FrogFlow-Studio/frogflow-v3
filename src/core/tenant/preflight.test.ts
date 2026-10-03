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

describe("консультант по прайсу и баллы", () => {
  const run = (extra: object) =>
    evaluatePreflight({ ...base, modulesOn: [...base.modulesOn], ...extra });
  const check = (extra: object, key: string) => run(extra).checks.find((c) => c.key === key);

  it("флаг включён, а прайс пуст — переезд блокируется", () => {
    const p = run({ pricelist: { enabled: true, items: 0, rateFresh: true } });
    expect(p.ready).toBe(false);
    expect(preflightBlockers(p)).toContain("Консультант по прайсу без прайса");
  });

  it("прайс консультанта v1 есть, а флаг выключен — предупреждение", () => {
    expect(
      check({ pricelist: { enabled: false, items: 792, rateFresh: false } }, "pricelist"),
    ).toMatchObject({ level: "warn", detail: expect.stringContaining("792") });
  });

  it("курс устарел — предупреждение; всё на месте — пункта нет", () => {
    expect(
      check({ pricelist: { enabled: true, items: 792, rateFresh: false } }, "pricelist"),
    ).toMatchObject({ level: "warn", title: "Курс рубля для консультанта устарел" });
    expect(
      check({ pricelist: { enabled: true, items: 792, rateFresh: true } }, "pricelist"),
    ).toBeUndefined();
    expect(
      check({ pricelist: { enabled: false, items: 0, rateFresh: false } }, "pricelist"),
    ).toBeUndefined();
  });

  it("баллы у покупателей в другой валюте — предупредить продавца", () => {
    expect(
      check({ loyalty: { holders: 40, foreignOrders30d: 12, shopCurrency: "KZT" } }, "loyalty"),
    ).toMatchObject({ level: "warn", detail: expect.stringContaining("12 заказов не в KZT") });
    expect(
      check({ loyalty: { holders: 40, foreignOrders30d: 0, shopCurrency: "KZT" } }, "loyalty"),
    ).toBeUndefined();
  });
});

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
      modulesOn: ["shop", "kaspi_pay"],
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

  it("аккаунты Zernio без профиля — блок: вебхук v2 фильтрует по профилям", () => {
    const p = evaluatePreflight({
      ...shop,
      channelOrders30d: 12,
      zernioAccounts: 1,
      zernioProfile: false,
    });
    expect(preflightBlockers(p)).toEqual(["Нет профиля Zernio"]);
    for (const i of [
      { zernioAccounts: 1, zernioProfile: true },
      { zernioAccounts: 0, zernioProfile: false },
      { zernioAccounts: 1 },
    ]) {
      const ok = evaluatePreflight({ ...shop, ...i });
      expect(ok.checks.find((c) => c.key === "zernio_profile")).toBeUndefined();
    }
  });

  it("заказы из Instagram/WhatsApp без секрета вебхука Zernio — блок", () => {
    const p = evaluatePreflight({
      ...shop,
      channelOrders30d: 5,
      zernioAccounts: 1,
      zernioSecret: false,
    });
    expect(preflightBlockers(p)).toEqual(["Не задан секрет вебхука Zernio"]);
    for (const i of [
      { channelOrders30d: 5, zernioAccounts: 1, zernioSecret: true },
      { channelOrders30d: 0, zernioSecret: false },
    ])
      expect(
        evaluatePreflight({ ...shop, ...i }).checks.find((c) => c.key === "zernio_secret"),
      ).toBeUndefined();
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

  it("сторис-теги v1: сколько перенесётся при переключении и сколько не влезет в предел", () => {
    const tag = (p: ReturnType<typeof evaluatePreflight>) =>
      p.checks.find((c) => c.key === "story_tags");
    // Всё влезает — справка, сколько перенесётся.
    const fits = evaluatePreflight({
      ...shop,
      storyTags: { v1: 40, v2: 10, add: 30, dropped: 0, max: 200 },
    });
    expect(tag(fits)?.level).toBe("info");
    expect(tag(fits)!.detail).toContain("30");
    // 100 своих в v2 и 150 из v1: 50 не влезут в предел 200 — предупреждение с числом.
    const over = evaluatePreflight({
      ...shop,
      storyTags: { v1: 150, v2: 100, add: 100, dropped: 50, max: 200 },
    });
    expect(tag(over)?.level).toBe("warn");
    expect(tag(over)!.detail).toContain("50");
    expect(tag(over)!.detail).toContain("200");
    expect(over.ready).toBe(true);
    // Всё уже перенесено или тегов в v1 нет — пункта нет.
    for (const storyTags of [
      { v1: 40, v2: 40, add: 0, dropped: 0, max: 200 },
      { v1: 0, v2: 5, add: 0, dropped: 0, max: 200 },
    ])
      expect(tag(evaluatePreflight({ ...shop, storyTags }))).toBeUndefined();
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

describe("онлайн-школа в проверке переезда", () => {
  const check = (school?: { courses: number; withoutLessons: number; withoutChannel: number }) =>
    evaluatePreflight({
      ...base,
      modulesOn: [...base.modulesOn],
      ...(school ? { school } : {}),
    }).checks.find((c) => c.key === "school");

  it("не передано — пункта нет; всё на месте — тоже", () => {
    expect(check()).toBeUndefined();
    expect(check({ courses: 2, withoutLessons: 0, withoutChannel: 0 })).toBeUndefined();
  });

  it("нет курсов — подсказка, не блок", () => {
    expect(check({ courses: 0, withoutLessons: 0, withoutChannel: 0 })).toMatchObject({
      level: "info",
      title: "В школе нет курсов",
    });
  });

  it("курс без уроков — предупреждение с числами; без канала — подсказка", () => {
    expect(check({ courses: 3, withoutLessons: 1, withoutChannel: 3 })).toMatchObject({
      level: "warn",
      detail: expect.stringContaining("1 из 3"),
    });
    expect(check({ courses: 2, withoutLessons: 0, withoutChannel: 2 })).toMatchObject({
      level: "info",
      title: "У курсов нет закрытого канала",
    });
  });
});
