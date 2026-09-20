import { describe, expect, it } from "vitest";
import { buildPaymentUrl, md5Hex, robokassaConfig, verifyResultSignature } from "./robokassa";

const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";

describe("robokassa", () => {
  it("ссылка на оплату подписана с Shp_bot и суммой в две цифры", () => {
    const url = buildPaymentUrl(
      { login: "shop", pass1: "p1", pass2: "p2", testMode: true },
      { outSum: 1500, invId: 42, description: "Заказ #7", botId: BOT },
    );
    const u = new URL(url);
    expect(u.searchParams.get("OutSum")).toBe("1500.00");
    expect(u.searchParams.get("InvId")).toBe("42");
    expect(u.searchParams.get("IsTest")).toBe("1");
    expect(u.searchParams.get("Shp_bot")).toBe(BOT);
    expect(u.searchParams.get("SignatureValue")).toBe(md5Hex(`shop:1500.00:42:p1:Shp_bot=${BOT}`));
  });

  it("результат: подпись по pass2 с пользовательскими параметрами по алфавиту", () => {
    const sig = md5Hex(`1500.00:42:p2:Shp_bot=${BOT}`).toUpperCase();
    expect(
      verifyResultSignature({
        outSum: "1500.00",
        invId: "42",
        signature: sig.toLowerCase(),
        pass2: "p2",
        shp: [["Shp_bot", BOT]],
      }),
    ).toBe(true);
    expect(
      verifyResultSignature({
        outSum: "1500.00",
        invId: "42",
        signature: sig,
        pass2: "wrong",
        shp: [["Shp_bot", BOT]],
      }),
    ).toBe(false);
    expect(
      verifyResultSignature({
        outSum: "1500.00",
        invId: "42",
        signature: "abc",
        pass2: "p2",
        shp: [],
      }),
    ).toBe(false);
  });

  it("конфиг: включён, модуль, пароли по режиму", () => {
    const base = {
      robokassa_enabled: "true",
      robokassa_login: "L",
      robokassa_pass1: "a",
      robokassa_pass2: "b",
      robokassa_pass1_test: "ta",
      robokassa_pass2_test: "tb",
    };
    expect(robokassaConfig(base, true)).toMatchObject({
      ready: true,
      pass1: "a",
      pass2: "b",
      testMode: false,
    });
    expect(robokassaConfig({ ...base, robokassa_test_mode: "true" }, true)).toMatchObject({
      ready: true,
      pass1: "ta",
      pass2: "tb",
      testMode: true,
    });
    expect(robokassaConfig(base, false).ready).toBe(false);
    expect(robokassaConfig({ ...base, robokassa_pass2: "" }, true).ready).toBe(false);
  });
});
