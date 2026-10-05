import { describe, expect, it } from "vitest";
import {
  ADDRESSES_MAX,
  ADDRESS_MAX_CHARS,
  addAddress,
  cleanAddress,
  editAddress,
  parseAddresses,
  removeAddress,
} from "./addresses";

const id = (n: number) =>
  String(n)
    .padStart(12, "0")
    .replace(/\d/g, (d) => "abcdef0123"[Number(d)]!);
const row = (n: number, text = `Алматы, ${n}`) => ({ id: id(n), text });

describe("сохранённые адреса: правила", () => {
  it("адрес чистится, пустой и слишком длинный отвергаются, а не режутся", () => {
    expect(cleanAddress("  Алматы,   Абая 1 ")).toBe("Алматы, Абая 1");
    expect(cleanAddress("   ")).toBeNull();
    expect(cleanAddress("я".repeat(ADDRESS_MAX_CHARS + 1))).toBeNull();
    expect(cleanAddress("я".repeat(ADDRESS_MAX_CHARS))).not.toBeNull();
    expect(cleanAddress(42)).toBeNull();
  });

  it("из состояния читаются только годные строки: мусор, повторы id, всё сверх предела — прочь", () => {
    const raw = [
      row(1),
      { id: "плохой", text: "x" },
      { id: id(2), text: "" },
      row(1, "дубль id"),
      ...Array.from({ length: 10 }, (_, i) => row(10 + i)),
    ];
    const items = parseAddresses(raw);
    expect(items[0]).toEqual(row(1));
    expect(items).toHaveLength(ADDRESSES_MAX);
    expect(parseAddresses("не список")).toEqual([]);
  });

  it("добавление: новый наверху, тот же адрес не повторяется, предел — «full»", () => {
    const r = addAddress([row(1)], "Астана, Мира 5");
    expect(r.ok && r.items!.map((i) => i.text)).toEqual(["Астана, Мира 5", "Алматы, 1"]);
    const again = addAddress([row(1), row(2)], "алматы, 2");
    expect(again.ok && again.items!.map((i) => i.id)).toEqual([id(2), id(1)]);
    expect(addAddress([row(1)], "АЛМАТЫ, 1")).toEqual({ ok: true, items: null });
    const full = Array.from({ length: ADDRESSES_MAX }, (_, i) => row(i + 1));
    expect(addAddress(full, "Новый")).toEqual({ ok: false, reason: "full" });
    expect(addAddress([], "  ")).toEqual({ ok: false, reason: "bad_text" });
  });

  it("изменение и удаление — только по своему id", () => {
    const items = [row(1), row(2)];
    const e = editAddress(items, id(2), "Шымкент, 7");
    expect(e.ok && e.items!.find((i) => i.id === id(2))!.text).toBe("Шымкент, 7");
    expect(editAddress(items, id(9), "x")).toEqual({ ok: false, reason: "unknown" });
    expect(editAddress(items, id(1), "Алматы, 2")).toMatchObject({ ok: true });
    expect(removeAddress(items, id(1))).toEqual({ ok: true, items: [row(2)] });
    expect(removeAddress(items, id(9))).toEqual({ ok: false, reason: "unknown" });
  });
});
