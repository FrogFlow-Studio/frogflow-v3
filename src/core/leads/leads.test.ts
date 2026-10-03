import { describe, expect, it } from "vitest";
import {
  LEAD_STAGES,
  cleanLeadInput,
  duplicateOf,
  funnelCounts,
  leadMatches,
  normalizeHandle,
  normalizePhone,
  normalizeSiteUrl,
  stageEventDetail,
  stageTimestamps,
} from "./leads";

describe("нормализация контактов лида", () => {
  it("Instagram: @имя, ссылка и имя дают одно и то же", () => {
    expect(normalizeHandle("@Sever.Coffee")).toBe("sever.coffee");
    expect(normalizeHandle("https://www.instagram.com/Sever.Coffee/?hl=ru")).toBe("sever.coffee");
    expect(normalizeHandle("два слова")).toBeNull();
  });
  it("телефон: только цифры, 10–15", () => {
    expect(normalizePhone("+7 (705) 111-22-33")).toBe("77051112233");
    expect(normalizePhone("12345")).toBeNull();
  });
  it("сайт: без протокола, www и слэша; слово без точки — не сайт", () => {
    expect(normalizeSiteUrl("https://www.Example.kz/")).toBe("example.kz");
    expect(normalizeSiteUrl("просто текст")).toBeNull();
  });
});

describe("cleanLeadInput", () => {
  it("название и хоть один способ связи обязательны", () => {
    expect(cleanLeadInput({ businessName: "  ", phone: "77051112233" })).toBeNull();
    expect(cleanLeadInput({ businessName: "Кафе" })).toBeNull();
    expect(cleanLeadInput({ businessName: "Кафе", email: "не почта" })).toBeNull();
    expect(cleanLeadInput({ businessName: " Кафе  Север ", email: "A@B.kz" })).toMatchObject({
      businessName: "Кафе Север",
      email: "a@b.kz",
    });
  });
});

describe("воронка", () => {
  it("duplicateOf находит совпадение по любому контакту", () => {
    const a = { instagramHandle: "x", phone: null, email: null, websiteUrl: "a.kz" };
    expect(
      duplicateOf([a], { instagramHandle: null, phone: null, email: null, websiteUrl: "a.kz" }),
    ).toBe(a);
    expect(
      duplicateOf([a], { instagramHandle: "y", phone: null, email: null, websiteUrl: null }),
    ).toBeNull();
  });
  it("funnelCounts: неизвестная стадия — «Новый», все стадии присутствуют", () => {
    const c = funnelCounts([{ stage: "hot" }, { stage: "hot" }, { stage: "что-то из v1" }]);
    expect(c.hot).toBe(2);
    expect(c.new).toBe(1);
    expect(Object.keys(c)).toEqual([...LEAD_STAGES]);
  });
  it("метки времени не затирают первые", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    expect(stageTimestamps("contacted", { contacted_at: null, replied_at: null }, now)).toEqual({
      contacted_at: now.toISOString(),
    });
    expect(stageTimestamps("contacted", { contacted_at: "old", replied_at: null }, now)).toEqual(
      {},
    );
    expect(stageTimestamps("hot", { contacted_at: "old", replied_at: null }, now)).toEqual({
      replied_at: now.toISOString(),
    });
  });
  it("строка журнала и поиск", () => {
    expect(stageEventDetail("new", "hot")).toBe("Новый → Горячий");
    expect(stageEventDetail("старая_v1", "lost")).toBe("старая_v1 → Потерян");
    expect(leadMatches({ business_name: "Кофейня Север", city: "Астана" }, "астана")).toBe(true);
    expect(leadMatches({ business_name: "Кофейня" }, "пекарня")).toBe(false);
    expect(leadMatches({}, "")).toBe(true);
  });
});
