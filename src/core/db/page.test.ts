import { describe, expect, it } from "vitest";
import { eachPage, pageAll } from "./page";

/** Таблица из n строк, отдаётся кусками [from, to] включительно, как PostgREST range(). */
function table(n: number) {
  const rows = Array.from({ length: n }, (_, i) => i);
  const calls: Array<[number, number]> = [];
  const query = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { query, calls };
}

describe("pageAll: всё, а не первые 1000 строк", () => {
  it("забирает всё, что больше одной страницы", async () => {
    const { query } = table(2500);
    const got = await pageAll(query, "заказы");
    expect(got).toHaveLength(2500);
    expect(got.at(-1)).toBe(2499);
  });

  it("запрашивает страницы подряд, без пропусков и нахлёстов", async () => {
    const { query, calls } = table(25);
    expect(await pageAll(query, "t", 10)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(calls).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });

  it("останавливается на неполной странице — ровно одна страница", async () => {
    const { query, calls } = table(7);
    expect(await pageAll(query, "t", 10)).toHaveLength(7);
    expect(calls).toHaveLength(1);
  });

  it("ровно PAGE строк — спрашивает следующую страницу", async () => {
    const { query, calls } = table(10);
    expect(await pageAll(query, "t", 10)).toHaveLength(10);
    expect(calls).toEqual([
      [0, 9],
      [10, 19],
    ]);
  });

  it("пустая выборка — пустой результат, один запрос", async () => {
    const { query, calls } = table(0);
    expect(await pageAll(query, "t")).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("ошибку базы не проглатывает — иначе выгрузка выйдет неполной молча", async () => {
    let n = 0;
    const query = async () =>
      n++ === 0
        ? { data: Array.from({ length: 10 }, (_, i) => i), error: null }
        : { data: null, error: { message: "timeout" } };
    await expect(pageAll(query, "покупатели", 10)).rejects.toThrow("покупатели: timeout");
  });
});

describe("eachPage: обход без накопления", () => {
  it("отдаёт все страницы по очереди", async () => {
    const { query } = table(25);
    const seen: number[][] = [];
    await eachPage(query, "t", (rows) => void seen.push(rows), 10);
    expect(seen.map((p) => p.length)).toEqual([10, 10, 5]);
  });

  it("false из обработчика — дальше не читает", async () => {
    const { query, calls } = table(25);
    await eachPage(query, "t", () => false, 10);
    expect(calls).toHaveLength(1);
  });
});
