import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { telegramApi, telegramUpload } from "./api";

const fetchMock = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  setEnvForTests({});
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setEnvForTests(undefined);
});

const send = () => telegramApi("t").call("sendMessage", { chat_id: 1, text: "hi" });

describe("Telegram: отправка без слепых повторов (Б26)", () => {
  it("5xx на отправке — один вызов, результат без error_code", async () => {
    fetchMock.mockResolvedValue(
      json(502, { ok: false, error_code: 502, description: "Bad Gateway" }),
    );
    const r = await send();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(r.error_code).toBeUndefined();
  });

  it("обрыв на отправке — один вызов", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const r = await send();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: false, description: "network error" });
  });

  it("тайм-аут на отправке — один вызов", async () => {
    fetchMock.mockRejectedValue(new DOMException("t", "TimeoutError"));
    const r = await send();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: false, description: "timeout" });
  });

  it("у каждой попытки есть тайм-аут", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, result: {} }));
    await send();
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("429 повторяется после retry_after", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(429, { ok: false, error_code: 429, parameters: { retry_after: 2 } }),
      )
      .mockResolvedValueOnce(json(200, { ok: true, result: {} }));
    const p = send();
    await vi.advanceTimersByTimeAsync(2000);
    expect((await p).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("чтение getMe при 5xx повторяется", async () => {
    fetchMock
      .mockResolvedValueOnce(json(502, { ok: false }))
      .mockResolvedValueOnce(json(200, { ok: true, result: { id: 1 } }));
    const p = telegramApi("t").call("getMe");
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("загрузка файла: 5xx и обрыв — один вызов, 429 — повтор", async () => {
    const file = { field: "document", name: "a.pdf", data: new Blob(["x"]) };
    const up = () => telegramUpload("t", "https://api.telegram.org", "sendDocument", {}, file);
    fetchMock.mockResolvedValue(json(500, { ok: false, error_code: 500 }));
    const r = await up();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.error_code).toBeUndefined();

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await up();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        json(429, { ok: false, error_code: 429, parameters: { retry_after: 1 } }),
      )
      .mockResolvedValueOnce(json(200, { ok: true, result: {} }));
    const p = up();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
