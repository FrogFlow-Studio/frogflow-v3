import { describe, expect, it } from "vitest";
import { MONTHLY_PRICE } from "@/core/plans/registry";
import { landingJsonLd } from "./structured-data";

describe("landingJsonLd", () => {
  const ld = landingJsonLd({
    url: "https://www.frogflow.tech/?lang=kk",
    name: "FrogFlow",
    description: "Бот",
    locale: "kk",
  });
  const graph = ld["@graph"] as Array<Record<string, unknown>>;

  it("организация и приложение, связанные по @id", () => {
    const org = graph.find((n) => n["@type"] === "Organization")!;
    const app = graph.find((n) => n["@type"] === "SoftwareApplication")!;
    expect(app.publisher).toEqual({ "@id": org["@id"] });
    expect(app.url).toBe("https://www.frogflow.tech/?lang=kk");
    expect(app.inLanguage).toBe("kk");
  });

  it("цены — из реестра планов, в тенге", () => {
    const app = graph.find((n) => n["@type"] === "SoftwareApplication")!;
    const offers = app.offers as Record<string, unknown>;
    expect(offers.priceCurrency).toBe("KZT");
    expect(offers.lowPrice).toBe(MONTHLY_PRICE.basic);
    expect(offers.highPrice).toBe(MONTHLY_PRICE.business);
  });
});
