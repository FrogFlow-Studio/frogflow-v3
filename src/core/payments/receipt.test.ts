import { describe, expect, it } from "vitest";
import { md5Hex, buildPaymentUrl, robokassaAccepts, robokassaConfig } from "./robokassa";
import { parseReceiptSettings, receiptFor } from "./receipt";

/** Россия: Robokassa в рублях с чеком 54-ФЗ. */
const course = {
  fulfillment_kind: "digital",
  delivery_fee: 0,
  order_items: [
    { name_snapshot: "Аквагрим с нуля — С проверкой", quantity: 1, price_snapshot: 4900 },
  ],
};

describe("чек 54-ФЗ", () => {
  it("курс — услуга, полный расчёт, сумма чека = сумма оплаты", () => {
    expect(receiptFor(course, 4900, { sno: "usn_income", tax: "none" }, "Заказ #5")).toEqual({
      sno: "usn_income",
      items: [
        {
          name: "Аквагрим с нуля — С проверкой",
          quantity: 1,
          sum: 4900,
          payment_method: "full_payment",
          payment_object: "service",
          tax: "none",
        },
      ],
    });
  });

  it("скидка раскладывается по позициям без потери копейки; доставка — отдельной позицией", () => {
    const r = receiptFor(
      {
        fulfillment_kind: "physical",
        delivery_fee: 300,
        order_items: [
          { name_snapshot: "Кисти", quantity: 3, price_snapshot: 333.33 },
          { name_snapshot: "Краски", quantity: 1, price_snapshot: 1000 },
        ],
      },
      1500,
      { sno: null, tax: "vat20" },
      "Заказ",
    );
    expect(r.sno).toBeUndefined();
    expect(r.items.map((i) => i.name)).toEqual(["Кисти", "Краски", "Доставка"]);
    expect(Math.round(r.items.reduce((s, i) => s + i.sum, 0) * 100)).toBe(150_000);
    // Физический товар, оплачен не целиком — предоплата.
    expect(r.items.every((i) => i.payment_method === "prepayment")).toBe(true);
    expect(r.items[0]!.payment_object).toBe("commodity");
  });

  it("чек только при включённой галочке; НДС по умолчанию — без НДС", () => {
    expect(parseReceiptSettings({})).toBeNull();
    expect(parseReceiptSettings({ robokassa_receipt: "true", robokassa_sno: "xxx" })).toEqual({
      sno: null,
      tax: "none",
    });
  });
});

describe("Robokassa Россия", () => {
  const cfg = robokassaConfig(
    {
      robokassa_enabled: "true",
      robokassa_login: "school",
      robokassa_pass1: "p1",
      robokassa_pass2: "p2",
      robokassa_region: "ru",
      robokassa_receipt: "true",
      robokassa_sno: "usn_income",
    },
    true,
  );

  it("рубли, а не тенге; касса Казахстана — наоборот", () => {
    expect(cfg.ready && cfg.region).toBe("ru");
    expect(robokassaAccepts("RUB", "ru")).toBe(true);
    expect(robokassaAccepts("KZT", "ru")).toBe(false);
    expect(robokassaAccepts("KZT")).toBe(true);
  });

  it("ссылка на robokassa.ru; Receipt в подписи после InvId и в адресе", () => {
    if (!cfg.ready) throw new Error("не настроено");
    const receipt = receiptFor(course, 4900, cfg.receipt!, "Заказ #5");
    const url = new URL(
      buildPaymentUrl(cfg, {
        outSum: 4900,
        invId: 5,
        description: "Заказ #5",
        botId: "b1",
        receipt,
      }),
    );
    expect(url.origin).toBe("https://auth.robokassa.ru");
    const encoded = url.searchParams.get("Receipt")!;
    expect(JSON.parse(decodeURIComponent(encoded))).toEqual(receipt);
    expect(url.searchParams.get("SignatureValue")).toBe(
      md5Hex(`school:4900.00:5:${encoded}:p1:Shp_bot=b1`),
    );
  });

  it("Казахстан — прежняя ссылка без чека", () => {
    const kz = robokassaConfig(
      {
        robokassa_enabled: "true",
        robokassa_login: "a",
        robokassa_pass1: "p1",
        robokassa_pass2: "p2",
      },
      true,
    );
    if (!kz.ready) throw new Error("не настроено");
    const url = new URL(
      buildPaymentUrl(kz, { outSum: 100, invId: 1, description: "x", botId: "b" }),
    );
    expect(url.origin).toBe("https://auth.robokassa.kz");
    expect(url.searchParams.has("Receipt")).toBe(false);
    expect(url.searchParams.get("SignatureValue")).toBe(md5Hex("a:100.00:1:p1:Shp_bot=b"));
  });
});
