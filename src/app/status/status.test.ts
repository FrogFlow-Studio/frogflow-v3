import { describe, expect, it } from "vitest";
import { overallState, serviceStatuses, type Signal } from "./status";
import { statusT } from "./i18n";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

const run = (job: string, ok: boolean, stale = false, at = "2026-09-28T10:00:00Z") => ({
  job,
  stale,
  last: { at, ok },
});
const ALL_OK = [
  run("ensure-webhook", true),
  run("health", true, false, "2026-09-28T10:05:00Z"),
  run("comment-dm-fallback", true),
  run("subscriptions", true),
  run("broadcast", true),
  run("cart-reminder", true),
  run("fulfillment-reminder", true),
  run("course-lives", true),
  run("vip", true),
  run("retention", true),
];
const GOOD: Record<string, Signal> = {
  telegram_bots: { state: "ok" },
  zernio_webhook: { state: "ok" },
  database: { state: "ok" },
};
const get = (s: ReturnType<typeof serviceStatuses>, key: string) => s.find((x) => x.key === key)!;

describe("страница статуса", () => {
  it("каналы, оплата и витрина — отдельные службы, при здоровых данных всё работает", () => {
    const s = serviceStatuses(ALL_OK, GOOD);
    for (const k of ["telegram", "instagram", "whatsapp", "payments", "storefront"])
      expect(get(s, k).state).toBe("ok");
    expect(get(s, "telegram").lastOkAt).toBe("2026-09-28T10:05:00Z");
    expect(overallState(s)).toBe("ok");
  });

  it("сбой вебхука Zernio гасит Instagram и WhatsApp, но не Telegram, с датой сбоя", () => {
    const s = serviceStatuses(ALL_OK, {
      ...GOOD,
      zernio_webhook: { state: "degraded", lastFailAt: "2026-09-28T09:00:00Z" },
    });
    expect(get(s, "instagram")).toMatchObject({
      state: "degraded",
      lastFailAt: "2026-09-28T09:00:00Z",
    });
    expect(get(s, "whatsapp").state).toBe("degraded");
    expect(get(s, "telegram").state).toBe("ok");
    expect(overallState(s)).toBe("degraded");
  });

  it("упавший запуск крона — сбой службы с датой запуска; молчание задачи — сбой без даты", () => {
    const failed = serviceStatuses(
      [
        ...ALL_OK.filter((c) => c.job !== "broadcast"),
        run("broadcast", false, false, "2026-09-28T08:00:00Z"),
      ],
      GOOD,
    );
    expect(get(failed, "broadcasts")).toMatchObject({
      state: "degraded",
      lastFailAt: "2026-09-28T08:00:00Z",
    });
    const stale = serviceStatuses(
      [...ALL_OK.filter((c) => c.job !== "vip"), run("vip", true, true)],
      GOOD,
    );
    expect(get(stale, "vip")).toMatchObject({ state: "degraded", lastFailAt: null });
  });

  it("чтение не удалось — «нет данных», а не «работает»", () => {
    const noSignals = serviceStatuses(ALL_OK, {
      ...GOOD,
      telegram_bots: { state: "unknown", readFailed: true },
      zernio_webhook: { state: "unknown", readFailed: true },
    });
    expect(get(noSignals, "telegram").state).toBe("unknown");
    expect(get(noSignals, "instagram").state).toBe("unknown");
    expect(get(noSignals, "whatsapp").state).toBe("unknown");
    expect(get(noSignals, "storefront").state).toBe("ok");
    // Кроны не прочитались: службы с задачами — «нет данных», без задач (витрина) — по сигналу.
    const noCrons = serviceStatuses(null, GOOD);
    expect(get(noCrons, "telegram").state).toBe("unknown");
    expect(get(noCrons, "broadcasts").state).toBe("unknown");
    expect(get(noCrons, "storefront").state).toBe("ok");
    expect(overallState(serviceStatuses(null, {}))).toBe("unknown");
  });

  it("база недоступна — витрина и оплата с перебоями", () => {
    const s = serviceStatuses(ALL_OK, { ...GOOD, database: { state: "degraded" } });
    expect(get(s, "storefront").state).toBe("degraded");
    expect(get(s, "payments").state).toBe("degraded");
  });

  it("наружу идут только ключ, состояние и две даты", () => {
    const s = serviceStatuses(ALL_OK, GOOD);
    for (const x of s)
      expect(Object.keys(x).sort()).toEqual(["key", "lastFailAt", "lastOkAt", "state"]);
  });

  it("все строки страницы есть на четырёх языках и не пустые", () => {
    const ru = statusT("ru");
    for (const l of SUPPORTED_LOCALES) {
      const t = statusT(l);
      for (const k of [
        "title.ok",
        "title.degraded",
        "title.unknown",
        "state.ok",
        "state.degraded",
        "state.unknown",
        "note",
      ] as const)
        expect(t(k).length).toBeGreaterThan(3);
      for (const x of s0()) expect(t(`service.${x}` as "service.vip").length).toBeGreaterThan(1);
      if (l !== "ru") expect(t("title.ok")).not.toBe(ru("title.ok"));
    }
  });
});

const s0 = () => serviceStatuses(ALL_OK, GOOD).map((x) => x.key);
