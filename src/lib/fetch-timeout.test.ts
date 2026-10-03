import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DB_TIMEOUT_MS, fetchWith } from "@/core/db/client.server";

/**
 * Замок: у каждого `fetch(` в src/ есть `signal` (тайм-аут). Без него зависший
 * ответ держит функцию до предела Vercel, а отправка могла дойти.
 */
const EXCEPTIONS: Record<string, string> = {
  "src/server.ts": "точка входа Nitro: `.fetch(request…)` приложения, а не запрос наружу",
  "src/app/ui/report-client.ts":
    "клиентский отчёт об ошибке: `void fetch` с keepalive, ответ не ждём",
};

function callBody(s: string, open: number): string {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return s.slice(open, i + 1);
  }
  return s.slice(open);
}

describe("тайм-ауты всех fetch (Б27)", () => {
  it("в src/ у каждого `fetch(` есть signal", () => {
    const files = execSync("git ls-files 'src/*.ts' 'src/*.tsx'", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((f) => f && !/\.test\.tsx?$/.test(f) && !EXCEPTIONS[f]);
    const bare: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/(?<![\w.$])fetch\(/g)) {
        const body = callBody(s, m.index! + m[0].length - 1);
        if (!/\bsignal\b/.test(body)) {
          bare.push(`${f}:${s.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(bare, "fetch без signal: добавьте AbortSignal.timeout(…)").toEqual([]);
  });

  it("исключения не устарели: файл ещё существует и в нём есть fetch", () => {
    for (const f of Object.keys(EXCEPTIONS)) {
      expect(readFileSync(f, "utf8")).toMatch(/fetch/);
    }
  });
});

describe("клиент базы: тайм-аут запроса", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("зависший запрос обрывается по тайм-ауту", async () => {
    // Таймер AbortSignal.timeout — родной, фальшивые часы его не двигают: подменяем сигнал.
    const timer = new AbortController();
    const spy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timer.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );
    const caught = fetchWith(
      "k",
      "k",
    )("https://x.supabase.co/rest/v1/orders").catch((e: unknown) => e);
    expect(spy).toHaveBeenCalledWith(DB_TIMEOUT_MS);
    timer.abort(new DOMException("t", "TimeoutError"));
    expect(((await caught) as Error).name).toBe("TimeoutError");
    spy.mockRestore();
  });

  it("сигнал вызывающего тоже обрывает запрос", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: unknown, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return Promise.resolve(new Response("{}"));
      }),
    );
    const own = new AbortController();
    await fetchWith("k", "k")("https://x.supabase.co/rest/v1/orders", { signal: own.signal });
    own.abort();
    expect(seen?.aborted).toBe(true);
  });
});
