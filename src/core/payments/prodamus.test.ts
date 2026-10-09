import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildProdamusLink,
  normalizeFormUrl,
  chargeRef,
  parseChargeRef,
  parsePhpForm,
  prodamusCharge,
  prodamusAccepts,
  prodamusConfig,
  prodamusOutcome,
  prodamusSign,
  verifyProdamusSign,
} from "./prodamus";

const s = {
  prodamus_enabled: "true",
  prodamus_form_url: "kopilka.payform.ru",
  prodamus_secret_key: "secret",
};

describe("Продамус", () => {
  it("настройка готова только с модулем, тумблером, адресом формы и ключом", () => {
    expect(prodamusConfig(s, true)).toEqual({
      ready: true,
      formUrl: "https://kopilka.payform.ru",
      secretKey: "secret",
      currency: "RUB",
      rate: null,
    });
    expect(prodamusConfig(s, false).ready).toBe(false);
    expect(prodamusConfig({ ...s, prodamus_enabled: "false" }, true).ready).toBe(false);
    expect(prodamusConfig({ ...s, prodamus_secret_key: " " }, true).ready).toBe(false);
    expect(prodamusConfig({ ...s, prodamus_form_url: "" }, true).ready).toBe(false);
  });

  it("валюта кассы из настройки; кнопка только у заказов в ней", () => {
    const cfg = prodamusConfig({ ...s, prodamus_currency: "kzt" }, true);
    if (!cfg.ready) throw new Error("not ready");
    expect(cfg.currency).toBe("KZT");
    expect(prodamusAccepts(cfg, "KZT")).toBe(true);
    expect(prodamusAccepts(cfg, "RUB")).toBe(false);
    // Курс пересчитывает тенге; у кассы в тенге он не нужен и не действует.
    const kzt = prodamusConfig({ ...s, prodamus_currency: "KZT", prodamus_rate: "5.8" }, true);
    expect(kzt.ready && kzt.rate).toBe(null);
  });

  it("форма на .kz считает только в тенге: валюта кассы KZT, курс не действует", () => {
    // Копилка Русоведа, 09.10.2026: RUB и курс 5,23 — форма proeducation.kz выставила
    // 1148 ₸ за заказ на 6000 ₸ (параметр currency она не берёт).
    const cfg = prodamusConfig(
      {
        ...s,
        prodamus_form_url: "https://kopilka-rusoveda.proeducation.kz/",
        prodamus_currency: "RUB",
        prodamus_rate: "5.23",
      },
      true,
    );
    if (!cfg.ready) throw new Error("not ready");
    expect(cfg.currency).toBe("KZT");
    expect(cfg.rate).toBe(null);
    expect(prodamusCharge(cfg, 6000, "KZT")).toEqual({ amount: 6000, currency: "KZT" });
    expect(prodamusAccepts(cfg, "RUB")).toBe(false);
  });

  it("касса в рублях, цены в тенге: без курса кнопки нет, с курсом — рубли вверх до целого", () => {
    const plain = prodamusConfig(s, true);
    if (!plain.ready) throw new Error("not ready");
    expect(prodamusAccepts(plain, "KZT")).toBe(false);
    expect(prodamusCharge(plain, 1500, "KZT")).toBeNull();
    expect(prodamusCharge(plain, 990.5, "RUB")).toEqual({ amount: 990.5, currency: "RUB" });
    const cfg = prodamusConfig({ ...s, prodamus_rate: "5,8" }, true);
    if (!cfg.ready) throw new Error("not ready");
    expect(cfg.rate).toBe(5.8);
    expect(prodamusAccepts(cfg, "KZT")).toBe(true);
    // 1500 / 5,8 = 258,6… → 259 ₽: продавец не получает меньше цены в тенге.
    expect(prodamusCharge(cfg, 1500, "KZT")).toEqual({ amount: 259, currency: "RUB" });
    // Ровно делится — без лишнего рубля.
    expect(prodamusCharge(cfg, 580, "kzt")).toEqual({ amount: 100, currency: "RUB" });
    expect(prodamusCharge(cfg, 10, "USD")).toBeNull();
  });

  it("сумма к списанию в order_id под нашей подписью: подменить сумму или чужой ключ нельзя", () => {
    const cfg = prodamusConfig(s, true);
    if (!cfg.ready) throw new Error("not ready");
    const ref = chargeRef(cfg, 42, { amount: 259, currency: "RUB" });
    expect(ref).toMatch(/^42-25900-[0-9a-f]{16}$/);
    expect(parseChargeRef(cfg, ref)).toEqual({ orderId: 42, amount: 259, currency: "RUB" });
    expect(parseChargeRef(cfg, ref.replace("-25900-", "-100-"))).toBeNull();
    expect(parseChargeRef(cfg, ref.replace(/^42-/, "43-"))).toBeNull();
    const other = prodamusConfig({ ...s, prodamus_secret_key: "other" }, true);
    if (!other.ready) throw new Error("not ready");
    expect(parseChargeRef(other, ref)).toBeNull();
    expect(parseChargeRef(cfg, "42")).toBeNull();
  });

  it("адрес формы: только https и хост, путь и хвост отбрасываются", () => {
    expect(normalizeFormUrl("https://shop.payform.ru/some/path?x=1")).toBe(
      "https://shop.payform.ru",
    );
    expect(normalizeFormUrl("http://shop.payform.ru")).toBeNull();
    expect(normalizeFormUrl("localhost")).toBeNull();
  });

  it("подпись как у библиотеки Продамуса: ключи по порядку, строки, «/» экранирован, кириллица как есть", () => {
    const data = { b: 2, a: "x/y", products: [{ price: 10, name: "Набор" }] };
    const json = '{"a":"x\\/y","b":"2","products":[{"name":"Набор","price":"10"}]}';
    expect(prodamusSign(data, "k")).toBe(createHmac("sha256", "k").update(json).digest("hex"));
    // Порядок ключей на входе не важен.
    expect(
      prodamusSign({ products: [{ name: "Набор", price: "10" }], a: "x/y", b: "2" }, "k"),
    ).toBe(prodamusSign(data, "k"));
  });

  it("уведомление: тело в стиле PHP разбирается и подпись Sign сходится; чужой ключ — нет", () => {
    const body =
      "order_id=777&order_num=42-150000-abc&sum=1500.00&currency=rub&payment_status=success" +
      "&products%5B0%5D%5Bname%5D=%D0%97%D0%B0%D0%BA%D0%B0%D0%B7+%2311&products%5B0%5D%5Bprice%5D=1500.00";
    const n = parsePhpForm(body);
    expect(n.products).toEqual([{ name: "Заказ #11", price: "1500.00" }]);
    const sign = prodamusSign(n, "secret");
    expect(verifyProdamusSign(parsePhpForm(body), sign, "secret")).toBe(true);
    expect(verifyProdamusSign(parsePhpForm(body), sign.toUpperCase(), "secret")).toBe(true);
    expect(verifyProdamusSign(parsePhpForm(body), sign, "other")).toBe(false);
    expect(verifyProdamusSign(parsePhpForm(body), null, "secret")).toBe(false);
    // Подправленная сумма — подпись не сходится.
    const forged = parsePhpForm(body.replace("sum=1500.00", "sum=1.00"));
    expect(verifyProdamusSign(forged, sign, "secret")).toBe(false);
  });

  it("оплачено только при success и совпадении суммы и валюты", () => {
    const exp = { amount: 1500, currency: "RUB" };
    const n = { payment_status: "success", sum: "1500.00", currency: "rub" };
    expect(prodamusOutcome(n, exp)).toBe("paid");
    expect(prodamusOutcome({ ...n, payment_status: "order_canceled" }, exp)).toBe("ignore");
    expect(prodamusOutcome({ ...n, sum: "1.00" }, exp)).toBe("mismatch");
    expect(prodamusOutcome({ ...n, currency: "kzt" }, exp)).toBe("mismatch");
  });

  it("ссылка: форма продавца, заказ, сумма, адрес уведомления и подпись по этим же полям", () => {
    const cfg = prodamusConfig(s, true);
    if (!cfg.ready) throw new Error("not ready");
    const url = new URL(
      buildProdamusLink(cfg, {
        amount: 1500,
        orderId: 42,
        description: "Заказ #11",
        notifyUrl: "https://app.example/api/prodamus/bot",
        successUrl: "https://t.me/shop_bot",
        returnUrl: "https://t.me/shop_bot",
      }),
    );
    expect(url.origin).toBe("https://kopilka.payform.ru");
    const q = parsePhpForm(url.search.slice(1));
    expect(q).toMatchObject({
      do: "pay",
      currency: "rub",
      payments_limit: "1",
      urlNotification: "https://app.example/api/prodamus/bot",
      products: [{ name: "Заказ #11", price: "1500.00", quantity: "1", sku: "42" }],
    });
    expect(parseChargeRef(cfg, q.order_id)).toEqual({ orderId: 42, amount: 1500, currency: "RUB" });
    const { signature, ...signed } = q;
    expect(signature).toBe(prodamusSign(signed, "secret"));
  });
});
