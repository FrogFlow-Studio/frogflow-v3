import { describe, expect, it } from "vitest";
import { BOM } from "@/core/export/csv";
import { dailyCsv, productsCsv, type ExportOrder } from "./export";

const o = (
  id: number,
  day: string,
  platform: string,
  currency: string,
  revenue: number,
  scale = 1,
): ExportOrder => ({
  id,
  day,
  platform,
  currency,
  revenue,
  scale,
});
const lines = (csv: string) => csv.replace(BOM, "").split("\r\n");

describe("выгрузка по дням", () => {
  it("BOM, «;», по дню/каналу/валюте, средний чек", () => {
    const { csv, count } = dailyCsv([
      o(1, "2026-09-02", "telegram", "KZT", 1000),
      o(2, "2026-09-02", "telegram", "KZT", 2001),
      o(3, "2026-09-02", "web", "USD", 10),
      o(4, "2026-09-01", "telegram", "KZT", 500),
    ]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(count).toBe(3);
    expect(lines(csv)).toEqual([
      "Дата;Канал;Валюта;Выручка;Заказов;Средний чек",
      "2026-09-01;telegram;KZT;500;1;500",
      "2026-09-02;telegram;KZT;3001;2;1500.5",
      "2026-09-02;web;USD;10;1;10",
    ]);
  });

  it("пустой период — только заголовок", () => {
    const { csv, count } = dailyCsv([]);
    expect(count).toBe(0);
    expect(lines(csv)).toEqual(["Дата;Канал;Валюта;Выручка;Заказов;Средний чек"]);
  });

  it("канал с запретным началом ячейки экранируется", () => {
    const { csv } = dailyCsv([o(1, "2026-09-02", "=cmd", "KZT", 1)]);
    expect(lines(csv)[1]).toContain("'=cmd");
  });
});

describe("выгрузка по товарам", () => {
  const item = (order_id: number, name: string, price: number, qty: number) => ({
    order_id,
    product_id: name,
    name_snapshot: name,
    price_snapshot: price,
    quantity: qty,
  });

  it("валюты отдельно, кавычки и «;» в названии, масштаб заказа в работе", () => {
    const { csv, count } = productsCsv(
      [
        o(1, "d", "web", "KZT", 500, 0.5),
        o(2, "d", "web", "KZT", 1000),
        o(3, "d", "web", "USD", 9),
      ],
      [item(1, 'Курс "А"; часть', 1000, 1), item(2, "Книга", 500, 2), item(3, "Курс USD", 9, 1)],
    );
    expect(count).toBe(3);
    expect(lines(csv)).toEqual([
      "Товар;Валюта;Штук;Заказов;Выручка",
      "Книга;KZT;2;1;1000",
      '"Курс ""А""; часть";KZT;1;1;500',
      "Курс USD;USD;1;1;9",
    ]);
  });

  it("пустой период — только заголовок", () => {
    expect(lines(productsCsv([], []).csv)).toEqual(["Товар;Валюта;Штук;Заказов;Выручка"]);
  });
});
