import { describe, expect, it } from "vitest";
import { fromJson, toJson } from "./json";

describe("toJson / fromJson", () => {
  it("не меняют значение, только тип", () => {
    const v = { kind: "x", n: 1, list: [1, 2] };
    expect(toJson(v)).toBe(v);
    expect(fromJson<typeof v>(toJson(v))).toBe(v);
  });
});
