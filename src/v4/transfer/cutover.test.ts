import { describe, expect, it } from "vitest";
import { servedByWritable } from "../core/served-by";
import { canCutOver, servedByAfter } from "./cutover";

describe("переезд магазина", () => {
  it("без зелёных кнопок и книги флаг не ставим", () => {
    expect(
      canCutOver({ buttonsGreen: false, bookGreen: true, aiOn: false, shadowGreen: false }),
    ).toBe(false);
    expect(
      canCutOver({ buttonsGreen: true, bookGreen: true, aiOn: true, shadowGreen: false }),
    ).toBe(false);
    expect(
      canCutOver({ buttonsGreen: true, bookGreen: true, aiOn: false, shadowGreen: false }),
    ).toBe(true);
    expect(canCutOver({ buttonsGreen: true, bookGreen: true, aiOn: true, shadowGreen: true })).toBe(
      true,
    );
  });

  it("откат — флаг v2, и только когда переезд разрешён", () => {
    expect(servedByAfter("switch", false)).toBeNull();
    expect(servedByAfter("rollback", false)).toBeNull();
    expect(servedByAfter("rollback", true)).toBe("v2");
    expect(servedByAfter("switch", true)).toBe("v4");
    expect(servedByWritable("v4")).toBe(false);
  });
});
