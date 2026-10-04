import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { settingsFromJson } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";

/**
 * Обходы публичной жалобы площадки (З4): смена устройства или адреса, пустой и огромный текст,
 * разметка в тексте, жалоба на скрытый, чужой и несуществующий магазин. Функция вызывается
 * целиком (разбор формы, задача для браузера, лимиты, запись); подменены только база, адрес
 * посетителя и проверка подписи задачи — её отдельно покрывают тесты challenge.
 */
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse: (d: unknown) => unknown = (d) => d;
    const b = {
      validator(v: (d: unknown) => unknown) {
        parse = v;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        return (a: { data: unknown }) => h({ data: parse(a.data) });
      },
    };
    return b;
  },
}));
vi.mock("@/config/env", () => ({ env: () => ({ SESSION_SECRET: "s".repeat(32) }) }));

let db: FakeDb;
let ip: string | null = "10.0.0.1";
let challengeFailure: string | null = null;
const claimed = new Set<string>();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/app/auth/login-guard.server", () => ({
  clientIp: () => ip,
  loginDelay: async () => {},
}));
vi.mock("@/app/signup/challenge", () => ({
  CHALLENGE_TOO_FAST: "fast",
  issueChallenge: () => "c",
  challengeNonce: (c: string) => c,
  verifyChallenge: () => challengeFailure,
}));
vi.mock("@/app/signup/signup.server", () => ({
  claimChallenge: async (nonce: string) => {
    const seen = claimed.has(nonce);
    claimed.add(nonce);
    return seen;
  },
  ipHash: (a: string | null) => String(a).padEnd(32, "0").slice(0, 32),
}));

const SHOPS: Record<string, Tenant | null> = {};
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async (l: { value: string }) => SHOPS[l.value] ?? null,
  tenantContext: () => ({ db }),
}));

const { submitReportFn } = await import("./report.functions");

const PRODUCT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const tenant = (id: string, json: Record<string, unknown> = {}) =>
  ({
    id,
    name: `Магазин ${id}`,
    vertical: "shop",
    settings: settingsFromJson({
      served_by: "v2",
      slug: id,
      marketplace: { listed: true, approved: true },
      ...json,
    }),
  }) as unknown as Tenant;

const DEV1 = "a".repeat(32);
const DEV2 = "b".repeat(32);
let n = 0;
const form = (over: Record<string, unknown> = {}) => ({
  slug: "a",
  productId: "",
  reason: "fraud" as const,
  text: "Взяли деньги и пропали",
  device: DEV1,
  challenge: `ch-${++n}`,
  answer: "1",
  ...over,
});
const send = (over: Record<string, unknown> = {}) => submitReportFn({ data: form(over) } as never);
const reports = () => (db.tables.zernio_logs ?? []).filter((r) => r.event_type === "market.report");

beforeEach(() => {
  db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  ip = "10.0.0.1";
  challengeFailure = null;
  claimed.clear();
  for (const k of Object.keys(SHOPS)) delete SHOPS[k];
  Object.assign(SHOPS, {
    a: tenant("a"),
    hidden: tenant("hidden", { marketplace: { listed: true, approved: true, hidden: true } }),
    pending: tenant("pending", { marketplace: { listed: true, approved: false } }),
    unlisted: tenant("unlisted", { marketplace: { listed: false } }),
    v1: tenant("v1", { served_by: "v1" }),
  });
  db.tables.products = [{ id: PRODUCT, bot_id: "a", name: "Торт" }];
});

describe("обход «одна жалоба»", () => {
  it("тот же адрес, другое устройство — не вторая жалоба, ответ тот же", async () => {
    expect(await send({ device: DEV1 })).toEqual({ ok: true });
    expect(await send({ device: DEV2 })).toEqual({ ok: true });
    expect(reports()).toHaveLength(1);
  });

  it("то же устройство, другой адрес — не вторая жалоба, и лишняя строка не остаётся", async () => {
    await send();
    ip = "10.0.0.2";
    expect(await send()).toEqual({ ok: true });
    expect(reports()).toHaveLength(1);
    expect(
      (db.tables.zernio_logs ?? []).filter((r) => r.event_type === "market.report.claim"),
    ).toHaveLength(1);
  });

  it("другой адрес и другое устройство — отдельная жалоба", async () => {
    await send();
    ip = "10.0.0.3";
    await send({ device: DEV2 });
    expect(reports()).toHaveLength(2);
  });

  it("без номера устройства или с неверным — всё равно один адрес, одна жалоба", async () => {
    await send({ device: "" });
    await send({ device: "не-устройство" });
    expect(reports()).toHaveLength(1);
  });

  it("повтор той же задачи (старая страница, два щелчка) — «обновите страницу», строки нет", async () => {
    expect(await send({ challenge: "same" })).toEqual({ ok: true });
    ip = "10.0.0.9";
    expect(await send({ challenge: "same", device: DEV2 })).toEqual({
      ok: false,
      error: "refresh",
    });
    expect(reports()).toHaveLength(1);
  });

  it("задача не решена или решена слишком быстро — ничего не пишется", async () => {
    challengeFailure = "bad";
    expect(await send()).toEqual({ ok: false, error: "refresh" });
    challengeFailure = "fast";
    expect(await send()).toEqual({ ok: false, error: "fast" });
    expect(reports()).toHaveLength(0);
  });

  it("поле-приманка заполнено — функция не пускает, строки нет", async () => {
    expect(() => send({ website: "http://spam.test" })).toThrow();
    expect(reports()).toHaveLength(0);
  });
});

describe("текст жалобы", () => {
  it("пустой текст: для «другое» отказ, для остальных причин — принимается пустым", async () => {
    expect(await send({ reason: "other", text: "" })).toEqual({ ok: false, error: "text" });
    expect(await send({ reason: "other", text: "   \n\t " })).toEqual({ ok: false, error: "text" });
    expect(await send({ reason: "other", text: "ok" })).toEqual({ ok: false, error: "text" });
    expect(reports()).toHaveLength(0);
    expect(await send({ text: "" })).toEqual({ ok: true });
    expect(reports()[0]!.payload).toMatchObject({ text: "" });
  });

  it("очень длинный текст: больше 2000 знаков — отказ до записи, меньше — режется до 1000", async () => {
    expect(() => send({ text: "я".repeat(2001) })).toThrow();
    expect(() => send({ text: "я".repeat(1_000_000) })).toThrow();
    expect(reports()).toHaveLength(0);
    await send({ text: "я".repeat(2000) });
    expect((reports()[0]!.payload as { text: string }).text).toHaveLength(1000);
  });

  it("лишние поля запроса не попадают в строку: пишутся только известные", async () => {
    await send({ bot_id: "other", status: "closed", payload: { resolution: "hidden" } });
    const row = reports()[0]!;
    expect(row.bot_id).toBe("a");
    expect(row.status).toBe("open");
    expect(row.payload).not.toHaveProperty("resolution");
  });

  it("разметка хранится как текст и у оператора не исполняется", async () => {
    const markup = `<img src=x onerror=alert(1)> <script>alert("x")</script> {{7*7}} \${process.env}`;
    await send({ reason: "other", text: markup });
    expect((reports()[0]!.payload as { text: string }).text).toBe(markup);
    // Страницы с текстом жалобы выводят его как обычный текст React, без вставки готового HTML.
    for (const f of [
      "src/routes/operator._authed.market-reports.tsx",
      "src/routes/market.report.tsx",
      "src/app/operator/market-reports.server.ts",
    ])
      expect(readFileSync(f, "utf8"), f).not.toMatch(/dangerouslySetInnerHTML|innerHTML|\.html\(/);
    expect(readFileSync("src/routes/operator._authed.market-reports.tsx", "utf8")).toMatch(
      /\{r\.text\}/,
    );
  });
});

describe("жалоба на скрытый, чужой и несуществующий магазин", () => {
  it("скрытый оператором, ждущий одобрения, не на площадке, прежней платформы и несуществующий отвечают одинаково", async () => {
    const answers = [];
    for (const slug of ["hidden", "pending", "unlisted", "v1", "ghost", ""]) {
      ip = `10.1.0.${answers.length + 1}`;
      answers.push(await send({ slug }));
    }
    expect(new Set(answers.map((a) => JSON.stringify(a)))).toEqual(
      new Set([JSON.stringify({ ok: false, error: "unknown" })]),
    );
    expect(reports()).toHaveLength(0);
  });

  it("на товар чужого магазина и выдуманный товар — отказ без записи", async () => {
    SHOPS.b = tenant("b");
    expect(await send({ slug: "b", productId: PRODUCT })).toEqual({ ok: false, error: "unknown" });
    expect(await send({ productId: "c1111111-7944-441b-8f71-503184fc0f1f" })).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(reports()).toHaveLength(0);
  });

  it("товар видимого магазина — принимается, у жалобы название товара", async () => {
    expect(await send({ productId: PRODUCT })).toEqual({ ok: true });
    expect(reports()[0]!.payload).toMatchObject({ product_id: PRODUCT, product: "Торт" });
  });

  it("с одного адреса за сутки — не больше пяти жалоб на разные объекты", async () => {
    for (let i = 0; i < 5; i++) {
      SHOPS[`s${i}`] = tenant(`s${i}`);
      expect(await send({ slug: `s${i}`, device: String(i).repeat(32) })).toEqual({ ok: true });
    }
    SHOPS.s5 = tenant("s5");
    expect(await send({ slug: "s5", device: "9".repeat(32) })).toEqual({ ok: false, error: "ip" });
    expect(reports()).toHaveLength(5);
  });
});
