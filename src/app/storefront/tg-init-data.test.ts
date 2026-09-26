import { describe, expect, it } from "vitest";
import {
  CAPTURE_KEY,
  SDK_PARAMS_KEY,
  captureLaunchParams,
  initDataFromLaunchParams,
  initDataFromSdkJson,
  pickInitData,
} from "./tg-init-data";

const INIT = "query_id=AAH&user=%7B%22id%22%3A1%7D&auth_date=1700000000&hash=abc";
const enc = encodeURIComponent(INIT);

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    m,
  };
}

describe("initData Telegram Mini App без SDK", () => {
  it("читает tgWebAppData из hash Mini App", () => {
    expect(
      initDataFromLaunchParams(`#tgWebAppData=${enc}&tgWebAppVersion=7.0&tgWebAppPlatform=ios`),
    ).toBe(INIT);
  });

  it("читает tgWebAppData из query string", () => {
    expect(initDataFromLaunchParams(`?foo=1&tgWebAppData=${enc}`)).toBe(INIT);
  });

  it("собирает значение, если внутренний query не закодирован целиком", () => {
    expect(initDataFromLaunchParams(`#tgWebAppData=${INIT}&tgWebAppVersion=7.0`)).toBe(INIT);
  });

  it("пустой hash — пустая строка", () => {
    expect(initDataFromLaunchParams("")).toBe("");
    expect(initDataFromLaunchParams("#")).toBe("");
    expect(initDataFromLaunchParams("#section")).toBe("");
  });

  it("берёт tgWebAppData из JSON, который пишет telegram-web-app.js", () => {
    expect(
      initDataFromSdkJson(JSON.stringify({ tgWebAppData: INIT, tgWebAppVersion: "7.0" })),
    ).toBe(INIT);
  });

  it("игнорирует битый JSON", () => {
    expect(initDataFromSdkJson("{не json")).toBe("");
    expect(initDataFromSdkJson(JSON.stringify({ tgWebAppData: 5 }))).toBe("");
    expect(initDataFromSdkJson(null)).toBe("");
  });

  it("разбирает сохранённый hash+search", () => {
    const store = memStore();
    expect(captureLaunchParams({ hash: `#tgWebAppData=${enc}`, search: "" }, store)).toBe(INIT);
    expect(store.m.get(CAPTURE_KEY)).toBe(INIT);
    // Роутер сменил адрес — захваченное остаётся.
    expect(captureLaunchParams({ hash: "", search: "" }, store)).toBe(INIT);
    // Нет ни адреса, ни захвата — из sessionStorage SDK.
    const sdkOnly = memStore({ [SDK_PARAMS_KEY]: JSON.stringify({ tgWebAppData: INIT }) });
    expect(captureLaunchParams({ hash: "", search: "" }, sdkOnly)).toBe(INIT);
  });

  it("предпочитает SDK, затем capture, затем hash", () => {
    const hash = `#tgWebAppData=${encodeURIComponent("from=hash")}`;
    expect(pickInitData({ sdk: "from=sdk", captured: "from=capture", hash })).toBe("from=sdk");
    expect(pickInitData({ sdk: "", captured: "from=capture", hash })).toBe("from=capture");
    expect(pickInitData({ sdk: "", captured: "", hash })).toBe("from=hash");
    expect(pickInitData({})).toBe("");
  });

  it("захватывает launch params до SDK и не просит закрыть окно", () => {
    // Захват только читает адрес и пишет в хранилище: ни одного вызова Telegram.
    const store = memStore();
    const calls: string[] = [];
    (globalThis as { Telegram?: unknown }).Telegram = {
      WebApp: { close: () => calls.push("close"), ready: () => calls.push("ready") },
    };
    try {
      expect(captureLaunchParams({ hash: `#tgWebAppData=${enc}`, search: "" }, store)).toBe(INIT);
      expect(calls).toEqual([]);
    } finally {
      delete (globalThis as { Telegram?: unknown }).Telegram;
    }
  });

  it("хранилище недоступно (приватный режим) — не падает", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(captureLaunchParams({ hash: `#tgWebAppData=${enc}`, search: "" }, broken)).toBe(INIT);
    expect(captureLaunchParams({ hash: "", search: "" }, broken)).toBe("");
  });
});
