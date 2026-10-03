import { describe, expect, it, vi } from "vitest";
import {
  CRON_BUDGET_MS,
  CRON_GRACE_MS,
  cronBudget,
  eachWithin,
  inTurn,
  mapWithin,
  resumeOf,
} from "./cron-budget";

const ids = (...a: string[]) => a.map((id) => ({ id }));

describe("бюджет времени крона (Б30)", () => {
  it("бюджет считает остаток и исчерпывается", () => {
    let t = 1_000;
    const b = cronBudget(1_000, CRON_BUDGET_MS, () => t);
    expect(b.left()).toBe(CRON_BUDGET_MS);
    expect(b.spent()).toBe(false);
    t += CRON_BUDGET_MS + 5;
    expect(b.left()).toBe(0);
    expect(b.spent()).toBe(true);
  });

  it("очередь по кругу: с первого пропущенного, порядок по id стабилен", () => {
    const list = ids("c", "a", "b");
    expect(inTurn(list, null).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(inTurn(list, "c").map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(inTurn(list, "b").map((i) => i.id)).toEqual(["b", "c", "a"]);
    // Клиента с таким id больше нет — берём следующего по порядку.
    expect(inTurn(list, "bb").map((i) => i.id)).toEqual(["c", "a", "b"]);
    // Этапы: порядок задан, начало — точное совпадение.
    expect(inTurn(ids("x", "y", "z"), "z", false).map((i) => i.id)).toEqual(["z", "x", "y"]);
  });

  it("последовательный обход: при исчерпанном бюджете клиент не начат и записан как пропущенный", async () => {
    let t = 0;
    const b = cronBudget(0, 100, () => t);
    const seen: string[] = [];
    const skipped = new Set<string>();
    const order = ids("a", "b", "c");
    await eachWithin(order, b, skipped, async (x) => {
      seen.push(x.id);
      t += 60;
    });
    expect(seen).toEqual(["a", "b"]);
    expect([...skipped]).toEqual(["c"]);
    expect(resumeOf(order, skipped)).toBe("c");
  });

  it("параллельный обход: не начатых к концу бюджета нет в работе, сбой одного не мешает другим", async () => {
    let t = 0;
    const b = cronBudget(0, 100, () => t);
    const started: string[] = [];
    const skipped = new Set<string>();
    const out = await mapWithin(
      ids("a", "b", "c", "d"),
      b,
      skipped,
      async (x) => {
        started.push(x.id);
        t += 60;
        if (x.id === "a") throw new Error("сбой a");
        return x.id;
      },
      1,
    );
    expect(started).toEqual(["a", "b"]);
    expect(out.get("a")).toMatchObject({ status: "rejected" });
    expect(out.get("b")).toEqual({ status: "fulfilled", value: "b" });
    expect(out.get("c")).toEqual({ status: "skipped" });
    expect([...skipped]).toEqual(["c", "d"]);
  });

  it("зависший клиент не держит ответ дольше бюджета и грации", async () => {
    vi.useFakeTimers();
    try {
      const b = cronBudget(Date.now(), 20);
      const skipped = new Set<string>();
      const pending = mapWithin(ids("slow"), b, skipped, () => new Promise<string>(() => {}), 1);
      await vi.advanceTimersByTimeAsync(20 + CRON_GRACE_MS + 1);
      const out = await pending;
      expect(out.get("slow")).toMatchObject({ status: "rejected" });
      expect([...skipped]).toEqual(["slow"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
