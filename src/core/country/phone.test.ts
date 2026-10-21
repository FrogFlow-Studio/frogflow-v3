import { describe, expect, it } from "vitest";
import { countryFromPhone } from "./phone";

describe("countryFromPhone", () => {
  it("распознаёт номера Казахстана (KZ)", () => {
    expect(countryFromPhone("+7 701 123 45 67")).toBe("KZ");
    expect(countryFromPhone("77001234567")).toBe("KZ");
    expect(countryFromPhone("+7 (777) 987-65-43")).toBe("KZ");
    expect(countryFromPhone("+77471234567")).toBe("KZ");
    expect(countryFromPhone("87011234567")).toBe("KZ");
    expect(countryFromPhone("wa_77011234567")).toBe("KZ");
  });

  it("распознаёт номера России (RU)", () => {
    expect(countryFromPhone("+7 926 123 45 67")).toBe("RU");
    expect(countryFromPhone("79991234567")).toBe("RU");
    expect(countryFromPhone("+7 (495) 123-45-67")).toBe("RU");
    expect(countryFromPhone("89261234567")).toBe("RU");
    expect(countryFromPhone("wa_79261234567")).toBe("RU");
  });

  it("распознаёт номера Кыргызстана (KG)", () => {
    expect(countryFromPhone("+996 555 12 34 56")).toBe("KG");
    expect(countryFromPhone("996700123456")).toBe("KG");
    expect(countryFromPhone("wa_996555123456")).toBe("KG");
  });

  it("распознаёт номера Узбекистана (UZ)", () => {
    expect(countryFromPhone("+998 90 123 45 67")).toBe("UZ");
    expect(countryFromPhone("998931234567")).toBe("UZ");
  });

  it("распознаёт номера Беларуси (BY)", () => {
    expect(countryFromPhone("+375 29 123 45 67")).toBe("BY");
    expect(countryFromPhone("375441234567")).toBe("BY");
  });

  it("пустые, короткие и неизвестные номера дают null", () => {
    expect(countryFromPhone("")).toBeNull();
    expect(countryFromPhone(null)).toBeNull();
    expect(countryFromPhone(undefined)).toBeNull();
    expect(countryFromPhone("12345")).toBeNull();
    expect(countryFromPhone("+1 555 123 4567")).toBeNull();
  });
});
