import { describe, expect, it } from "vitest";
import { daytime, defaultWinback, parseWinback, winbackStep, winbackText } from "./winback";

const cfg = { ...defaultWinback(), enabled: true, days1: 30, days2: 60, promo: "BACK10" };
const now = new Date("2026-09-26T08:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("возвратные продажи", () => {
  it("шаг серии: первое через 30 дней, второе через 60, после — тишина; новый заказ сбрасывает", () => {
    const o = (d: number) => ({ id: 7, at: ago(d) });
    expect(winbackStep(cfg, o(10), undefined, now)).toBe(0);
    expect(winbackStep(cfg, o(31), undefined, now)).toBe(1);
    expect(winbackStep(cfg, o(40), { order_id: 7, step: 1 }, now)).toBe(0);
    expect(winbackStep(cfg, o(61), { order_id: 7, step: 1 }, now)).toBe(2);
    expect(winbackStep(cfg, o(90), { order_id: 7, step: 2 }, now)).toBe(0);
    expect(winbackStep(cfg, o(31), { order_id: 5, step: 2 }, now)).toBe(1);
    expect(winbackStep(cfg, o(200), undefined, now)).toBe(0);
    expect(winbackStep({ ...cfg, days2: null }, o(61), { order_id: 7, step: 1 }, now)).toBe(0);
  });
  it("подстановки; без промокода строка с {promo} выпадает", () => {
    expect(winbackText(cfg, 2, "Аня")).toBe(
      "Аня, напоминаем о себе: для вас действует промокод BACK10.",
    );
    const noPromo = { ...cfg, promo: "", text1: "{name}, привет!\nКод: {promo}" };
    expect(winbackText(noPromo, 1, null)).toBe("Здравствуйте, привет!");
  });
  it("разбор настроек: мусорные дни и второй шаг раньше первого отбрасываются", () => {
    const p = parseWinback(JSON.stringify({ enabled: true, days1: 1, days2: 20, promo: " back " }));
    expect(p.days1).toBe(30);
    expect(p.days2).toBeNull();
    expect(p.promo).toBe("BACK");
  });
  it("только днём по поясу магазина", () => {
    expect(daytime(new Date("2026-09-26T06:00:00Z"), "Asia/Almaty")).toBe(true); // 11:00
    expect(daytime(new Date("2026-09-26T16:00:00Z"), "Asia/Almaty")).toBe(false); // 21:00
  });
});
