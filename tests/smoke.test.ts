import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECKS, fingerprint, runCheck, type Check } from "../scripts/smoke.ts";
import { seedDb } from "./e2e/seed.ts";

// Подставной «сервер»: так проверяем сами проверки — что они краснеют, когда должны.
const db = seedDb();
let base = "";
const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/open-webhook") {
    // «Вебхук без секрета»: отвечает 200 и пишет в базу — именно это smoke обязан поймать.
    (db.tables.zernio_logs ??= []).push({ id: "x" });
    res.writeHead(200).end("ok");
  } else if (url === "/slow") {
    setTimeout(() => res.writeHead(200).end("late"), 400);
  } else if (url === "/to-login") {
    res.writeHead(302, { location: "/operator/login" }).end();
  } else if (url === "/operator/login") {
    res.writeHead(200).end("login");
  } else if (url === "/forbidden") {
    res.writeHead(403).end("no");
  } else {
    res.writeHead(200).end("hello FrogFlow");
  }
});

beforeAll(
  () =>
    new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => {
        base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        resolve();
      }),
    ),
);
afterAll(() => server.close());

const check = (over: Partial<Check>): Check => ({ name: "t", path: "/", status: [200], ...over });

describe("smoke: проверки краснеют, когда должны", () => {
  it("верный статус и текст — зелёный", async () => {
    expect(await runCheck(check({ bodyIncludes: "FrogFlow" }), db, base)).toMatchObject({
      ok: true,
    });
  });

  it("неверный статус — красный", async () => {
    const r = await runCheck(check({ path: "/forbidden" }), db, base);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("403");
  });

  it("вебхук, ответивший 200 вместо 401, — красный", async () => {
    const r = await runCheck(
      check({ method: "POST", path: "/open-webhook", body: "{}", status: [401] }),
      db,
      base,
    );
    expect(r.ok).toBe(false);
  });

  it("запрос без секрета, который что-то записал, — красный даже при верном статусе", async () => {
    const r = await runCheck(
      check({ method: "POST", path: "/open-webhook", body: "{}", status: [200], noWrites: true }),
      db,
      base,
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("изменил");
  });

  it("редирект на вход засчитывается по окончательному адресу", async () => {
    const ok = await runCheck(
      check({ path: "/to-login", finalUrlIncludes: "/operator/login" }),
      db,
      base,
    );
    expect(ok.ok).toBe(true);
    const bad = await runCheck(check({ path: "/", finalUrlIncludes: "/operator/login" }), db, base);
    expect(bad.ok).toBe(false);
  });

  it("недоступный сервер — красный, а не зависание", async () => {
    const r = await runCheck(check({}), db, "http://127.0.0.1:1");
    expect(r.ok).toBe(false);
  });

  it("отпечаток меняется от записи в таблицу и от сообщения бота", () => {
    const d = seedDb();
    const f0 = fingerprint(d);
    d.telegram.push({ method: "sendMessage", token: "t", body: {} });
    expect(fingerprint(d)).not.toBe(f0);
  });
});

describe("smoke: список адресов", () => {
  it("около пятнадцати, у вебхуков и кронов — noWrites, у каждого есть ожидаемый статус", () => {
    expect(CHECKS.length).toBeGreaterThanOrEqual(14);
    for (const c of CHECKS) expect(c.status.length, c.name).toBeGreaterThan(0);
    for (const c of CHECKS.filter((c) => c.path.startsWith("/api/") && c.path !== "/api/health"))
      expect(c.noWrites, c.name).toBe(true);
  });
});
