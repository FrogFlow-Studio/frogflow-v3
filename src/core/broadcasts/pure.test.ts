import { describe, expect, it } from "vitest";
import {
  buttonLabel,
  classifyDeliveryError,
  contentProblem,
  finalStatus,
  isRealTelegramChat,
  normalizeContent,
  progressPercent,
} from "./pure";

describe("classifyDeliveryError", () => {
  it("блокировку и удалённый аккаунт считает blocked", () => {
    expect(classifyDeliveryError("Forbidden: bot was blocked by the user")).toBe("blocked");
    expect(classifyDeliveryError("Forbidden: user is deactivated")).toBe("blocked");
    expect(classifyDeliveryError("Bad Request: chat not found")).toBe("blocked");
  });
  it("остальное — failed", () => {
    expect(classifyDeliveryError("Too Many Requests: retry after 5")).toBe("failed");
    expect(classifyDeliveryError(undefined)).toBe("failed");
  });
});

describe("finalStatus", () => {
  it("ни одного доставленного при непустой аудитории — failed", () => {
    expect(finalStatus(0, 10)).toBe("failed");
    expect(finalStatus(1, 10)).toBe("completed");
    expect(finalStatus(0, 0)).toBe("completed");
  });
});

describe("isRealTelegramChat", () => {
  it("отсеивает синтетические отрицательные id других каналов", () => {
    expect(isRealTelegramChat(123)).toBe(true);
    expect(isRealTelegramChat(-981237)).toBe(false);
    expect(isRealTelegramChat("123")).toBe(false);
    expect(isRealTelegramChat(NaN)).toBe(false);
  });
});

describe("normalizeContent / contentProblem", () => {
  it("режет дубли и лимиты", () => {
    const c = normalizeContent({
      text: "  привет ",
      photoKeys: ["a", "a", "b", ...Array.from({ length: 20 }, (_, i) => `p${i}`)],
      productIds: Array.from({ length: 12 }, (_, i) => `id${i}`),
      showCatalog: true,
    });
    expect(c.text).toBe("привет");
    expect(c.photoKeys.length).toBe(10);
    expect(c.photoKeys.slice(0, 2)).toEqual(["a", "b"]);
    expect(c.productIds.length).toBe(8);
  });
  it("пустое сообщение — ошибка, фото без текста — нормально", () => {
    expect(contentProblem({ text: "", photoKeys: [], productIds: [], showCatalog: false })).toMatch(
      /текст/i,
    );
    expect(
      contentProblem({ text: "", photoKeys: ["k"], productIds: [], showCatalog: false }),
    ).toBeNull();
    expect(
      contentProblem({ text: "x".repeat(4001), photoKeys: [], productIds: [], showCatalog: false }),
    ).toMatch(/4000/);
  });
});

describe("buttonLabel / progressPercent", () => {
  it("обрезает длинные названия с многоточием", () => {
    expect(buttonLabel("Короткое")).toBe("Короткое");
    expect(buttonLabel("a".repeat(50))).toHaveLength(36);
    expect(buttonLabel("a".repeat(50)).endsWith("…")).toBe(true);
    expect(buttonLabel("   ")).toBe("Товар");
  });
  it("считает прогресс по всем исходам", () => {
    expect(
      progressPercent({ total_count: 10, sent_count: 3, failed_count: 1, blocked_count: 1 }),
    ).toBe(50);
    expect(
      progressPercent({ total_count: 0, sent_count: 0, failed_count: 0, blocked_count: 0 }),
    ).toBe(100);
  });
});
