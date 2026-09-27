import { describe, expect, it } from "vitest";
import {
  isAdminInputStorageKey,
  isDeliverableStorageKey,
  isSafeStorageKey,
  isTenantStorageKey,
} from "./keys";

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

describe("isDeliverableStorageKey", () => {
  it("пропускает ключ со своим bot_id-префиксом, без учёта регистра", () => {
    expect(isDeliverableStorageKey(T, `${T}/a.pdf`)).toBe(true);
    expect(isDeliverableStorageKey(T, `${T.toUpperCase()}/a.pdf`)).toBe(true);
  });

  it("отклоняет ключ с чужим bot_id-префиксом и обход префикса", () => {
    expect(isDeliverableStorageKey(T, `${OTHER}/a.pdf`)).toBe(false);
    expect(isDeliverableStorageKey(T, `${T}/../${OTHER}/a.pdf`)).toBe(false);
    expect(isDeliverableStorageKey(T, `a/%2e%2e/${OTHER}/a.pdf`)).toBe(false);
  });

  it("пропускает ключ без префикса — файлы v1, залитые до разметки ключей", () => {
    expect(isDeliverableStorageKey(T, "1782643012614-ni1xub.pdf")).toBe(true);
    expect(isDeliverableStorageKey(T, "materials/урок.pdf")).toBe(true);
  });
});

describe("isAdminInputStorageKey — ключ из формы админки", () => {
  const stored = new Set(["1782643012614-ni1xub.pdf", `${OTHER}/a.pdf`]);

  it("свой префикс — да, как раньше", () => {
    expect(isAdminInputStorageKey(T, `${T}/a.png`, new Set())).toBe(true);
  });

  it("старый ключ v1 без префикса — только если он уже записан у этой строки", () => {
    expect(isAdminInputStorageKey(T, "1782643012614-ni1xub.pdf", stored)).toBe(true);
    // Новый ключ без префикса из формы — чужой файл v1 не подсунуть.
    expect(isAdminInputStorageKey(T, "9999999999999-zzzz.pdf", stored)).toBe(false);
    expect(isAdminInputStorageKey(T, "1782643012614-ni1xub.pdf", new Set())).toBe(false);
  });

  it("чужой префикс и обход — нет, даже если записан", () => {
    expect(isAdminInputStorageKey(T, `${OTHER}/a.pdf`, stored)).toBe(false);
    const bad = `a/%2e%2e/${OTHER}/a.pdf`;
    expect(isAdminInputStorageKey(T, bad, new Set([bad]))).toBe(false);
  });
});
