import { describe, expect, it } from "vitest";
import { overallState, serviceStatuses } from "./status";

const run = (job: string, ok: boolean, stale = false, at = "2026-09-28T10:00:00Z") => ({
  job,
  stale,
  last: { at, ok },
});

describe("страница статуса", () => {
  it("служба работает, когда все её задачи прошли вовремя; сбой или тишина — перебои", () => {
    const s = serviceStatuses([
      run("ensure-webhook", true),
      run("health", true, false, "2026-09-28T10:05:00Z"),
      run("broadcast", false),
      run("cart-reminder", true, true),
      run("fulfillment-reminder", true),
    ]);
    expect(s.find((x) => x.key === "bots")).toEqual({
      key: "bots",
      state: "ok",
      lastOkAt: "2026-09-28T10:05:00Z",
    });
    expect(s.find((x) => x.key === "broadcasts")!.state).toBe("degraded");
    expect(s.find((x) => x.key === "reminders")!.state).toBe("degraded");
    expect(s.find((x) => x.key === "vip")!.state).toBe("unknown");
  });

  it("общий статус: база недоступна или любая служба с перебоями — перебои", () => {
    expect(overallState(true, [{ key: "a", state: "ok", lastOkAt: null }])).toBe("ok");
    expect(overallState(true, [{ key: "a", state: "unknown", lastOkAt: null }])).toBe("ok");
    expect(overallState(false, [])).toBe("degraded");
    expect(overallState(true, [{ key: "a", state: "degraded", lastOkAt: null }])).toBe("degraded");
  });
});
