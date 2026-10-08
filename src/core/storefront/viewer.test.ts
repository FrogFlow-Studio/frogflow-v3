import { describe, expect, it } from "vitest";
import { pinchZoom, stepIndex, swipeAction, toggleZoom, ZOOM_MAX, ZOOM_TAP } from "./viewer";

describe("просмотр фото: листание", () => {
  it("вперёд и назад без перескока по кругу", () => {
    expect(stepIndex(0, 1, 5)).toBe(1);
    expect(stepIndex(4, 1, 5)).toBe(4);
    expect(stepIndex(0, -1, 5)).toBe(0);
    expect(stepIndex(3, -1, 5)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
  it("свайп: влево — следующее, вправо — предыдущее, вниз — закрыть, короткий — тап", () => {
    expect(swipeAction(-80, 10)).toBe("next");
    expect(swipeAction(80, -10)).toBe("prev");
    expect(swipeAction(5, 150)).toBe("close");
    expect(swipeAction(10, 10)).toBeNull();
    expect(swipeAction(0, 60)).toBeNull();
    // Вверх не закрывает.
    expect(swipeAction(0, -200)).toBeNull();
  });
});

describe("просмотр фото: увеличение", () => {
  it("двумя пальцами — пропорционально, в пределах", () => {
    expect(pinchZoom(1, 100, 200)).toBe(2);
    expect(pinchZoom(2, 100, 50)).toBe(1);
    expect(pinchZoom(1, 100, 10_000)).toBe(ZOOM_MAX);
    expect(pinchZoom(1, 100, 10)).toBe(1);
    expect(pinchZoom(1.5, 0, 100)).toBe(1.5);
  });
  it("двойной тап переключает", () => {
    expect(toggleZoom(1)).toBe(ZOOM_TAP);
    expect(toggleZoom(2)).toBe(1);
  });
});
