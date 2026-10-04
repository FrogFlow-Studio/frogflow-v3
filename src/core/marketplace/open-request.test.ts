import { describe, expect, it } from "vitest";
import {
  OPEN_LIMITS,
  cleanOpenRequest,
  openVerdict,
  parseRequestMarker,
  requestSignals,
} from "./open-request";

const FORM = {
  vertical: "confectionery",
  tier: "pro",
  locale: "kk",
  businessName: "  Сладкая   Лавка ",
  phone: "+7 700 123 45 67",
  email: "",
  instagramHandle: "",
  city: "Алматы",
  comment: "Хочу бота",
};

describe("разбор заявки с площадки", () => {
  it("чистит поля и оставляет ниша, тариф, язык", () => {
    const r = cleanOpenRequest(FORM);
    expect(r).toEqual({
      ok: true,
      value: {
        vertical: "confectionery",
        tier: "pro",
        locale: "kk",
        businessName: "Сладкая Лавка",
        phone: "77001234567",
        email: null,
        instagramHandle: null,
        city: "Алматы",
        comment: "Хочу бота",
      },
    });
  });

  it("нужны ниша из списка, тариф, название и хотя бы один контакт", () => {
    expect(cleanOpenRequest({ ...FORM, vertical: "consultant" })).toEqual({
      ok: false,
      error: "niche",
    });
    expect(cleanOpenRequest({ ...FORM, vertical: undefined })).toEqual({
      ok: false,
      error: "niche",
    });
    expect(cleanOpenRequest({ ...FORM, tier: "enterprise" })).toEqual({ ok: false, error: "tier" });
    expect(cleanOpenRequest({ ...FORM, businessName: "  " })).toEqual({ ok: false, error: "name" });
    expect(cleanOpenRequest({ ...FORM, phone: "12" })).toEqual({ ok: false, error: "contact" });
    expect(cleanOpenRequest({ ...FORM, phone: "", instagramHandle: "@sweet_lavka" })).toMatchObject(
      {
        ok: true,
        value: { instagramHandle: "sweet_lavka", phone: null },
      },
    );
  });

  it("неизвестный язык — русский", () => {
    expect(cleanOpenRequest({ ...FORM, locale: "de" })).toMatchObject({ value: { locale: "ru" } });
  });

  it("отметка в signals читается обратно, чужой текст — нет", () => {
    const r = cleanOpenRequest(FORM);
    if (!r.ok) throw new Error("форма не разобрана");
    const text = requestSignals(r.value);
    expect(text).toContain("Ниша: Кондитерская");
    expect(parseRequestMarker(text)).toEqual({
      vertical: "confectionery",
      tier: "pro",
      locale: "kk",
    });
    expect(parseRequestMarker("Instagram, 3 тыс. подписчиков")).toBeNull();
    expect(parseRequestMarker("[ff-open v=hack t=pro l=ru]")).toBeNull();
    expect(parseRequestMarker(null)).toBeNull();
  });

  it("лимиты: по адресу и общий", () => {
    expect(openVerdict({ ip: OPEN_LIMITS.perIpPerDay - 1, total: 0 })).toBeNull();
    expect(openVerdict({ ip: OPEN_LIMITS.perIpPerDay, total: 0 })).toBe("ip");
    expect(openVerdict({ ip: 0, total: OPEN_LIMITS.totalPerDay })).toBe("total");
  });
});
