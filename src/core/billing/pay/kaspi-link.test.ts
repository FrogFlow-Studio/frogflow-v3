import { describe, expect, it } from "vitest";
import { kaspiLinkProvider, normalizeKaspiLink, qrSvg } from "./kaspi-link";
import { availableProviders, issueWithFallback, type IssueRequest } from "./provider";
import { transferProvider } from "./transfer";

const req: IssueRequest = {
  invoiceId: "inv-1",
  botId: "bot-1",
  amount: 9900,
  currency: "KZT",
  note: "План Basic на месяц",
  requisites: "Kaspi Gold 4400 …",
  ownerPhone: null,
};
const LINK = "https://pay.kaspi.kz/pay/frogflow";

describe("оплата по ссылке Kaspi Pay", () => {
  it("принимает только https-ссылки на kaspi.kz", () => {
    expect(normalizeKaspiLink(` ${LINK} `)).toBe(LINK);
    expect(normalizeKaspiLink("https://kaspi.kz/pay/x")).toBe("https://kaspi.kz/pay/x");
    expect(normalizeKaspiLink("http://pay.kaspi.kz/pay/x")).toBeNull();
    expect(normalizeKaspiLink("https://kaspi.kz.evil.com/pay")).toBeNull();
    expect(normalizeKaspiLink("https://evilkaspi.kz/pay")).toBeNull();
    expect(normalizeKaspiLink("https://user:pw@pay.kaspi.kz/")).toBeNull();
    expect(normalizeKaspiLink("javascript:alert(1)")).toBeNull();
    expect(normalizeKaspiLink("")).toBeNull();
  });

  it("без ссылки способ пропускается, счёт идёт переводом", async () => {
    const { ready, skipped } = await availableProviders(
      [kaspiLinkProvider(async () => ""), transferProvider],
      req,
    );
    expect(ready.map((p) => p.key)).toEqual(["transfer"]);
    expect(skipped[0]?.provider).toBe("kaspi_link");
  });

  it("со ссылкой — текст с суммой и ссылкой, payUrl для кнопки", async () => {
    const { issued } = await issueWithFallback(
      [kaspiLinkProvider(async () => LINK), transferProvider],
      req,
    );
    expect(issued.provider).toBe("kaspi_link");
    expect(issued.payUrl).toBe(LINK);
    expect(issued.ownerText).toContain(LINK);
    expect(issued.ownerText).toContain("ровно 9900 ₸");
    expect(issued.ownerText).toContain("чек");
  });

  it("не тенге — только перевод", async () => {
    const { ready } = await availableProviders(
      [kaspiLinkProvider(async () => LINK), transferProvider],
      { ...req, currency: "USD" },
    );
    expect(ready.map((p) => p.key)).toEqual(["transfer"]);
  });

  it("QR — SVG", () => {
    expect(qrSvg(LINK)).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });
});
