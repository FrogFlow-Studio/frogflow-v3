import { describe, expect, it } from "vitest";
import { isSafeStorageKey, isTenantStorageKey } from "./keys";

const T = "0bac1f86-5231-4e57-838d-2faa44d427e7";
const OTHER = "11111111-2222-4333-8444-555555555555";

describe("isSafeStorageKey", () => {
  it("пропускает ключи, которые пишет загрузка, и старые ключи v1", () => {
    expect(isSafeStorageKey(`${T}/0a1b2c3d4e5f60718293a4b5.png`)).toBe(true);
    expect(isSafeStorageKey("1783414427610-x7i24b.jpeg")).toBe(true);
    expect(isSafeStorageKey(`${T}/Урок 1 (итог).pdf`)).toBe(true);
  });

  it("отклоняет выход из каталога в любой записи", () => {
    for (const k of [
      "..",
      "../x",
      `${T}/../${OTHER}/a.pdf`,
      `${T}/./a.png`,
      "a/%2e%2e/%2e%2e/rest/v1/bots",
      "%2e%2e/x",
      "a/%252e%252e/x",
      "a\\..\\x",
      "a/...",
    ])
      expect(isSafeStorageKey(k), k).toBe(false);
  });

  it("отклоняет символы, меняющие адрес запроса", () => {
    for (const k of [
      "a.png?select=*",
      "a.png#x",
      "/a.png",
      "a//b.png",
      "a/",
      "a\u0000.png",
      "a\n.png",
      " a.png",
      "",
    ])
      expect(isSafeStorageKey(k), JSON.stringify(k)).toBe(false);
  });

  it("отклоняет слишком длинные и глубокие ключи", () => {
    expect(isSafeStorageKey("a".repeat(513))).toBe(false);
    expect(isSafeStorageKey("a/b/c/d/e/f/g")).toBe(false);
  });
});

describe("isTenantStorageKey", () => {
  it("свой префикс — да, чужой и обход префикса — нет", () => {
    expect(isTenantStorageKey(T, `${T}/a.png`)).toBe(true);
    expect(isTenantStorageKey(T, `${OTHER}/a.png`)).toBe(false);
    expect(isTenantStorageKey(T, `${T}/../${OTHER}/a.png`)).toBe(false);
    expect(isTenantStorageKey(T, `${T}/%2e%2e/${OTHER}/a.png`)).toBe(false);
    expect(isTenantStorageKey(T, "a.png")).toBe(false);
  });
});
