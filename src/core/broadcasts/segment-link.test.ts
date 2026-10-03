import { describe, expect, it } from "vitest";
import { inactiveSegmentSearch, parseSegmentParam } from "./segment-link";

describe("сегмент из адреса рассылок", () => {
  it("уснувшие: вид и дни", () => {
    expect(parseSegmentParam(inactiveSegmentSearch(60))).toEqual({ kind: "inactive", days: 60 });
    expect(parseSegmentParam({ segment: "inactive", days: "45" })).toEqual({
      kind: "inactive",
      days: 45,
    });
  });
  it("чужое и негодное игнорируется", () => {
    expect(parseSegmentParam({})).toBeNull();
    expect(parseSegmentParam({ segment: "cart" })).toBeNull();
    expect(parseSegmentParam({ segment: "inactive", days: 0 })).toBeNull();
    expect(parseSegmentParam({ segment: "inactive", days: 99999 })).toBeNull();
    expect(parseSegmentParam({ segment: "inactive" })).toBeNull();
  });
});
