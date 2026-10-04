import { describe, expect, it } from "vitest";
import { PULL_THRESHOLD, pullState } from "./pull-to-refresh";

describe("потянуть — обновить", () => {
  it("не на самом верху страницы жест не считается", () => {
    expect(pullState(0, 200, 30)).toBe("idle");
  });
  it("малое смещение — ничего, до порога — тянем, с порога — можно отпускать", () => {
    expect(pullState(100, 105, 0)).toBe("idle");
    expect(pullState(100, 100 + PULL_THRESHOLD - 1, 0)).toBe("pull");
    expect(pullState(100, 100 + PULL_THRESHOLD, 0)).toBe("ready");
  });
  it("движение вверх — ничего", () => {
    expect(pullState(300, 100, 0)).toBe("idle");
  });
});
