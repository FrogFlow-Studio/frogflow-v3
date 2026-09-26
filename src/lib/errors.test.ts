import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEvent,
  parseDsn,
  parseStack,
  reportError,
  resetErrorThrottle,
  sendTestError,
} from "./errors";

const DSN = "https://abc123@o42.ingest.sentry.io/4507";

afterEach(() => {
  resetErrorThrottle();
  vi.restoreAllMocks();
});

describe("parseDsn", () => {
  it("собирает адрес конверта и ключ, в том числе для GlitchTip с префиксом пути", () => {
    expect(parseDsn(DSN)).toEqual({
      endpoint: "https://o42.ingest.sentry.io/api/4507/envelope/",
      publicKey: "abc123",
    });
    expect(parseDsn("https://k@errors.example.com/sub/7")?.endpoint).toBe(
      "https://errors.example.com/sub/api/7/envelope/",
    );
  });
  it("пустой или кривой DSN — отчёты выключены", () => {
    for (const d of [undefined, "", "not a url", "https://host/1", "https://k@host/"])
      expect(parseDsn(d), String(d)).toBeNull();
  });
});

describe("buildEvent", () => {
  it("кладёт клиента и место в теги, стек — старыми кадрами вверх", () => {
    const err = new Error("база не ответила");
    err.stack = [
      "Error: база не ответила",
      "    at inner (/app/src/core/a.ts:10:5)",
      "    at outer (/app/src/core/b.ts:20:7)",
    ].join("\n");
    const ev = buildEvent(err, { where: "telegram.update", botId: "bot-1", extra: { n: 1 } });
    expect(ev.tags).toEqual({ where: "telegram.update", bot_id: "bot-1" });
    expect(ev.extra).toEqual({ n: 1 });
    expect(ev.event_id).toMatch(/^[0-9a-f]{32}$/);
    const ex = ev.exception.values[0]!;
    expect(ex).toMatchObject({ type: "Error", value: "база не ответила" });
    expect(ex.stacktrace?.frames.map((f) => f.function)).toEqual(["outer", "inner"]);
  });
  it("не-Error тоже превращается в понятное событие", () => {
    expect(buildEvent("строка", { where: "x" }).exception.values[0]!.value).toBe("строка");
    expect(parseStack(undefined)).toEqual([]);
  });
});

describe("reportError", () => {
  it("без DSN только пишет в журнал и никуда не ходит", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn();
    await reportError(new Error("x"), { where: "t" }, { dsn: undefined, fetch: f as never });
    expect(f).not.toHaveBeenCalled();
  });

  it("с DSN шлёт конверт с ключом; одинаковую ошибку — не чаще раза в минуту", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn(async () => new Response("{}"));
    let t = 1_000_000;
    const deps = { dsn: DSN, environment: "production", fetch: f as never, now: () => t };
    await reportError(new Error("сбой"), { where: "cron:broadcast", botId: "b" }, deps);
    await reportError(new Error("сбой"), { where: "cron:broadcast", botId: "b" }, deps);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://o42.ingest.sentry.io/api/4507/envelope/");
    expect(String((init.headers as Record<string, string>)["x-sentry-auth"])).toContain(
      "sentry_key=abc123",
    );
    const [head, item, event] = String(init.body)
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(item).toEqual({ type: "event" });
    expect(event.event_id).toBe(head.event_id);
    expect(event).toMatchObject({ environment: "production", tags: { bot_id: "b" } });
    t += 61_000;
    await reportError(new Error("сбой"), { where: "cron:broadcast", botId: "b" }, deps);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("недоступный Sentry не роняет обработку", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(
      reportError(new Error("x"), { where: "t" }, { dsn: DSN, fetch: f as never }),
    ).resolves.toBeUndefined();
  });
});

describe("sendTestError", () => {
  it("без DSN честно говорит, что учёт выключен", async () => {
    expect(await sendTestError({ dsn: undefined })).toMatchObject({ ok: false });
    expect(await sendTestError({ dsn: "oops" })).toMatchObject({ ok: false });
  });

  it("возвращает id события при приёме и код при отказе", async () => {
    const ok = await sendTestError({ dsn: DSN, fetch: (async () => new Response("{}")) as never });
    expect(ok).toMatchObject({ ok: true, status: 200 });
    if (ok.ok) expect(ok.eventId).toMatch(/^[0-9a-f]{32}$/);
    const denied = await sendTestError({
      dsn: DSN,
      fetch: (async () => new Response("", { status: 401 })) as never,
    });
    expect(denied).toMatchObject({ ok: false, status: 401 });
  });
});
