import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { sendPhotoOrText, type TelegramApi, type TgResult } from "@/channels/telegram/api";

/**
 * Внешние вызовы (Л3): у каждого запроса наружу есть тайм-аут, общий бюджет функции меньше 120 с,
 * а отправка, которая могла дойти, не повторяется и не дублируется другим способом.
 */
const files = () =>
  execSync("git ls-files 'src/*.ts' 'src/*.tsx'", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f && !/\.test\.tsx?$/.test(f));

function callBody(s: string, open: number): string {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return s.slice(open, i + 1);
  }
  return s.slice(open);
}

/** Не запросы наружу или тайм-аут задан в другом месте — с причиной. */
const NO_TIMEOUT_HERE: Record<string, string> = {
  "src/server.ts": "точка входа Nitro: `.fetch(request…)` приложения",
  "src/app/ui/report-client.ts": "клиентский отчёт об ошибке, keepalive, ответ не ждём",
  "src/app/admin/upload-client.ts": "загрузка из браузера: тайм-аут и отмена у вызывающего",
  "src/core/db/client.server.ts":
    "клиент базы: тайм-аут DB_TIMEOUT_MS склеен с сигналом вызывающего",
};

describe("тайм-аут у каждого запроса наружу (Л3)", () => {
  it("fetch, fetchImpl и (…fetch ?? fetch)(…) в src/ несут AbortSignal.timeout", () => {
    const bad: string[] = [];
    for (const f of files()) {
      if (NO_TIMEOUT_HERE[f]) continue;
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/(?<![\w.$])(?:fetch|fetchImpl)\(|\(\w+\.fetch \?\? fetch\)\(/g)) {
        const body = callBody(s, m.index! + m[0].length - 1);
        if (!/AbortSignal\.timeout\(/.test(body))
          bad.push(`${f}:${s.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(bad, "запрос без AbortSignal.timeout(…)").toEqual([]);
  });

  it("исключения не устарели", () => {
    for (const f of Object.keys(NO_TIMEOUT_HERE)) expect(readFileSync(f, "utf8")).toMatch(/fetch/);
  });

  it("SMTP: у транспорта почты заданы сроки соединения, приветствия и ответа", () => {
    const src = readFileSync("src/core/mail/mail.server.ts", "utf8");
    const body = callBody(src, src.indexOf("createTransport(") + "createTransport".length);
    for (const k of ["connectionTimeout", "greetingTimeout", "socketTimeout"])
      expect(body, k).toContain(k);
  });
});

describe("общий бюджет функции меньше 120 с (Л3)", () => {
  it("константы *BUDGET* и *DEADLINE* не больше 120 000 мс", () => {
    const over: string[] = [];
    for (const f of files()) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(
        /\b(\w*(?:BUDGET|DEADLINE)\w*)\s*(?::\s*number\s*)?=\s*([\d_]+)/g,
      )) {
        if (Number(m[2]!.replaceAll("_", "")) > 120_000) over.push(`${f}: ${m[1]} = ${m[2]}`);
      }
    }
    expect(over).toEqual([]);
  });

  it("в vercel.json нет maxDuration больше 120 с", () => {
    const cfg = readFileSync("vercel.json", "utf8");
    for (const m of cfg.matchAll(/"maxDuration"\s*:\s*(\d+)/g))
      expect(Number(m[1])).toBeLessThanOrEqual(120);
  });
});

describe("фото с подписью и запасной текст: отправка, которая могла дойти, не дублируется (Л3)", () => {
  const api = (res: TgResult) => {
    const call = vi.fn(async () => res);
    return { api: { call } as unknown as TelegramApi, call };
  };

  it("принято — текст не шлётся", async () => {
    const { api: a, call } = api({ ok: true });
    const text = vi.fn(async () => {});
    expect(await sendPhotoOrText(a, { chat_id: 1 }, text)).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
  });

  it("обрыв, тайм-аут, 5xx, 429 — «неизвестно»: один вызов, текст не шлётся", async () => {
    for (const res of [
      { ok: false, description: "network error" },
      { ok: false, description: "timeout" },
      { ok: false, error_code: 502 },
      { ok: false, error_code: 429 },
    ] as TgResult[]) {
      const { api: a, call } = api(res);
      const text = vi.fn(async () => {});
      expect(await sendPhotoOrText(a, { chat_id: 1 }, text)).toBe(true);
      expect(call).toHaveBeenCalledTimes(1);
      expect(text).not.toHaveBeenCalled();
    }
  });

  it("Telegram точно не принял (400, 403) — то же текстом, один раз", async () => {
    for (const code of [400, 403]) {
      const { api: a, call } = api({ ok: false, error_code: code });
      const text = vi.fn(async () => {});
      expect(await sendPhotoOrText(a, { chat_id: 1 }, text)).toBe(false);
      expect(call).toHaveBeenCalledTimes(1);
      expect(text).toHaveBeenCalledTimes(1);
    }
  });
});
