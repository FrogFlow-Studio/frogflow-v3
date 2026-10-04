import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRON_JOBS } from "./cron-status.server";
import {
  cronLight,
  cronRow,
  failuresLight,
  telegramLight,
  undeliveredLight,
  worstLight,
} from "./platform-health";

const now = new Date("2026-10-04T10:00:00Z");

describe("светофор крона", () => {
  it("свежий запуск — зелёный, дольше своего интервала — жёлтый, дольше трёх — красный", () => {
    expect(cronLight({ everyMin: 15, lastAt: "2026-10-04T09:50:00Z", ok: true }, now)).toBe(
      "green",
    );
    expect(cronLight({ everyMin: 15, lastAt: "2026-10-04T09:40:00Z", ok: true }, now)).toBe(
      "yellow",
    );
    expect(cronLight({ everyMin: 15, lastAt: "2026-10-04T09:10:00Z", ok: true }, now)).toBe("red");
  });
  it("ошибка последнего запуска — красный, не запускался — жёлтый", () => {
    expect(cronLight({ everyMin: 60, lastAt: "2026-10-04T09:59:00Z", ok: false }, now)).toBe("red");
    expect(cronLight({ everyMin: 60, lastAt: null, ok: null }, now)).toBe("yellow");
  });
  it("у не-зелёного есть подсказка «что делать», у зелёного нет", () => {
    const j = { job: "vip", title: "VIP", everyMin: 10 };
    expect(cronRow(j, { at: "2026-10-04T09:59:00Z", ok: true, error: null }, now).todo).toBeNull();
    expect(cronRow(j, null, now).todo).toContain("ещё не отметился");
    expect(cronRow(j, { at: "2026-10-04T09:59:00Z", ok: false, error: "x" }, now).todo).toContain(
      "ошибкой",
    );
    expect(cronRow(j, { at: "2026-10-04T08:00:00Z", ok: true, error: null }, now).todo).toContain(
      "молчит",
    );
  });
});

describe("очереди и отказы", () => {
  it("пороги недоставленных, сбоев и ботов Telegram", () => {
    expect(undeliveredLight(0)).toBe("green");
    expect(undeliveredLight(1)).toBe("yellow");
    expect(undeliveredLight(20)).toBe("red");
    expect(failuresLight(0)).toBe("green");
    expect(failuresLight(3)).toBe("yellow");
    expect(failuresLight(50)).toBe("red");
    expect(telegramLight(0, 10)).toBe("green");
    expect(telegramLight(1, 10)).toBe("yellow");
    expect(telegramLight(3, 10)).toBe("red");
  });
  it("общий итог — худший из светофоров", () => {
    expect(worstLight(["green", "yellow", "green"])).toBe("yellow");
    expect(worstLight(["yellow", "red"])).toBe("red");
    expect(worstLight([])).toBe("green");
  });
});

describe("новый крон без строки здесь — красный тест", () => {
  it("список страницы совпадает с задачами маршрута и vercel.json", () => {
    const route = readFileSync("src/routes/api/cron.$job.ts", "utf8");
    const cases = [...route.matchAll(/case "([a-z-]+)"/g)].map((m) => m[1]!).sort();
    expect(CRON_JOBS.map((j) => j.job).sort()).toEqual(cases);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: Array<{ path: string }>;
    };
    const paths = vercel.crons.map((c) => /^\/api\/cron\/([a-z-]+)$/.exec(c.path)?.[1]).sort();
    expect(paths).toEqual(cases);
  });
});
