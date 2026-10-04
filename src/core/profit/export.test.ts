import { describe, expect, it } from "vitest";
import { BOM } from "@/core/export/csv";
import { PROFIT_COLUMNS, PROFIT_NOTE, profitCsv } from "./export";
import type { ProfitReport } from "./report";

const rep: ProfitReport = {
  days: 30,
  currency: "KZT",
  revenue: 13000,
  orders: 2,
  cost: 6000,
  profit: 4000,
  margin: 0.4,
  unknown: { items: 1, revenue: 3000 },
  fromCurrent: { items: 0 },
  writeoffs: null,
  products: [
    {
      key: "a",
      name: "Торт",
      qty: 2,
      revenue: 10000,
      cost: 6000,
      profit: 4000,
      unknownQty: 0,
      unknownRevenue: 0,
    },
    {
      key: "b",
      name: "=Пирог",
      qty: 1,
      revenue: 3000,
      cost: 0,
      profit: 0,
      unknownQty: 1,
      unknownRevenue: 3000,
    },
  ],
  otherCurrencies: [{ currency: "USD", revenue: 20, orders: 1 }],
};

describe("CSV «Прибыль по товарам»", () => {
  const { csv, count } = profitCsv(rep);
  const lines = csv.slice(BOM.length).split("\r\n");

  it("открывается в Excel: BOM, разделитель «;», шапка", () => {
    expect(csv.startsWith(BOM)).toBe(true);
    expect(lines[0]).toBe(PROFIT_COLUMNS.join(";"));
    expect(count).toBe(2);
  });

  it("где себестоимости нет — пустые ячейки, не нули; формулы экранированы", () => {
    expect(lines[1]).toBe("Торт;KZT;2;10000;6000;4000;40;;");
    expect(lines[2]).toBe("'=Пирог;KZT;1;3000;;;;1;3000");
  });

  it("итог по прибыли только с себестоимостью, чужая валюта — отдельно без прибыли", () => {
    expect(lines[3]).toBe("Итого;KZT;3;13000;6000;4000;40;1;3000");
    expect(lines[4]).toBe("Другая валюта (1 зак.);USD;;20;;;;;");
  });

  it("последняя строка честно говорит про доставку, комиссии и рекламу", () => {
    expect(lines[5]).toBe(`"${PROFIT_NOTE}";;;;;;;;`); // в кавычках: в тексте есть «;»
    expect(PROFIT_NOTE).toContain("вместе с оплаченной покупателем доставкой");
    expect(PROFIT_NOTE).toContain("не вычтены");
  });
});
