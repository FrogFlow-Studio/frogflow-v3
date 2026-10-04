import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import { settingsFromJson } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";

/**
 * Мастер подключения канала на базе в памяти и подставном Zernio: шаги идут
 * по настоящему пути (профиль → ссылка входа → аккаунт → вебхук → входящее в
 * журнале), сбой на шаге называет причину, повтор не создаёт второй профиль,
 * клиент прежней платформы не затронут.
 */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));

const { startWizard, checkWizard, wizardSnapshot, wizardOperatorRows } =
  await import("./wizard.server");
const { tenantContext } = await import("@/core/tenant/resolve.server");

const BOT = "00000000-0000-4000-8000-0000000000aa";
const V1 = "00000000-0000-4000-8000-0000000000bb";
const HOOK = "https://app.test/api/zernio/webhook";

type Zernio = {
  profiles: { _id: string; name: string }[];
  accounts: { _id: string; platform: string; profileId: string; isExpired?: boolean }[];
  webhooks: object[];
  /** Ответ на ближайший запрос по пути: статус и нужно ли исполнить запрос до отказа (500 после записи). */
  fail: { path: string; status: number; applyFirst?: boolean }[];
  calls: string[];
};
let zernio: Zernio;

function stubZernio() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const path = new URL(url).pathname.replace(
        /^.*\/(profiles|connect|accounts|webhooks)/,
        "/$1",
      );
      const method = init?.method ?? "GET";
      zernio.calls.push(`${method} ${path}`);
      const failAt = zernio.fail.findIndex((f) => path.startsWith(f.path));
      const fail = failAt >= 0 ? zernio.fail.splice(failAt, 1)[0] : undefined;
      const respond = () => {
        if (path === "/profiles" && method === "GET") return { profiles: zernio.profiles };
        if (path === "/profiles" && method === "POST") {
          const body = JSON.parse(init!.body!) as { name: string };
          const p = { _id: `prof-${zernio.profiles.length + 1}`, name: body.name };
          zernio.profiles.push(p);
          return { profile: p };
        }
        if (path.startsWith("/connect/")) return { authUrl: `https://zernio.test/auth${path}` };
        if (path === "/accounts") {
          const pid = new URL(url).searchParams.get("profileId");
          return { accounts: zernio.accounts.filter((a) => !pid || a.profileId === pid) };
        }
        if (path === "/webhooks/settings") return { webhooks: zernio.webhooks };
        return {};
      };
      if (fail && !fail.applyFirst) return new Response("{}", { status: fail.status });
      const body = respond();
      if (fail) return new Response("{}", { status: fail.status });
      return Response.json(body);
    }),
  );
}

const rowOf = (id: string) => db.tables.bots!.find((b) => b.id === id)!;
// Разбираем jsonb как есть: форму записи проверяют сами утверждения теста.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settingsOf = (id: string) => rowOf(id).settings as Record<string, any>;

function ctxFor(id = BOT) {
  const settings = settingsFromJson(settingsOf(id));
  return tenantContext({
    id,
    name: "Магазин",
    status: "active",
    vertical: "digital",
    modules: { instagram: true, whatsapp: true },
    archived: false,
    settings,
  } as unknown as Tenant);
}

const NOW = new Date("2026-10-04T10:00:00.000Z");
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

function bindWebhook(profileId: string) {
  zernio.webhooks = [
    {
      _id: "wh1",
      url: HOOK,
      isActive: true,
      events: [
        "message.received",
        "comment.received",
        "account.disconnected",
        "whatsapp.template.status_updated",
        "message.failed",
      ],
      profileIds: [profileId],
      accountIds: [],
    },
  ];
}

function incoming(platform: string, createdAt: Date, outgoing = false) {
  const rows = (db.tables.zernio_logs ??= []);
  rows.push({
    id: `log-${rows.length + 1}`,
    bot_id: BOT,
    event_type: "message.received",
    status: "received",
    created_at: createdAt.toISOString(),
    payload: {
      event: "message.received",
      account: { platform, id: "acc-1" },
      message: { direction: outgoing ? "outgoing" : "incoming", sender: { id: "u1" } },
    },
  });
}

beforeEach(() => {
  setEnvForTests({ ZERNIO_API_KEY: "sk" });
  db = fakeDb();
  db.tables.bots = [
    { id: BOT, settings: { served_by: "v2", slug: "shop", rev: 1 } },
    { id: V1, settings: { served_by: "v1", slug: "old", rev: 1 } },
  ];
  zernio = { profiles: [], accounts: [], webhooks: [], fail: [], calls: [] };
  stubZernio();
});
afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

describe("мастер: путь от входа до тестового сообщения", () => {
  it("вход → вебхук → тест → готово, чужие ключи settings целы", async () => {
    // 1. Вход: профиль создан, ссылка выдана, запись «шаг входа».
    const s = await startWizard(ctxFor(), "instagram", NOW);
    expect(s.url).toBe("https://zernio.test/auth/connect/instagram");
    expect(s.state).toMatchObject({ step: "login", started: true });
    expect(zernio.profiles).toHaveLength(1);
    expect(settingsOf(BOT).zernio.wizard.instagram.step).toBe("login");

    // 2. Продавец вошёл, но вебхук платформы ещё не привязан к его профилю.
    zernio.accounts = [{ _id: "acc-1", platform: "instagram", profileId: "prof-1" }];
    let st = await checkWizard(ctxFor(), "instagram", { now: at(1) });
    expect(st).toMatchObject({ step: "webhook", problem: "webhook_off" });
    expect(settingsOf(BOT).zernio.wizard.instagram).toMatchObject({
      step: "webhook",
      problem: "webhook_off",
    });

    // 3. Оператор привязал вебхук — шаг тестового сообщения, отсчёт с этого момента.
    bindWebhook("prof-1");
    st = await checkWizard(ctxFor(), "instagram", { now: at(2) });
    expect(st).toMatchObject({ step: "test", testSince: at(2).toISOString() });
    expect(st.problem).toBeUndefined();

    // 4. Не те сообщения: до начала теста, чужой канал, исходящее — тест не пройден.
    incoming("instagram", at(1));
    incoming("whatsapp", at(3));
    incoming("instagram", at(3), true);
    st = await checkWizard(ctxFor(), "instagram", { now: at(4) });
    expect(st.step).toBe("test");

    // 5. Настоящее входящее из Instagram после начала теста.
    incoming("instagram", at(5));
    st = await checkWizard(ctxFor(), "instagram", { now: at(6) });
    expect(st.step).toBe("done");
    expect(settingsOf(BOT).zernio.wizard.instagram).toMatchObject({
      step: "done",
      test_at: at(5).toISOString(),
    });
    // Чужие ключи и профиль на месте, версия растёт.
    expect(settingsOf(BOT).slug).toBe("shop");
    expect(settingsOf(BOT).zernio.profile_id).toBe("prof-1");
    expect(settingsOf(BOT).rev).toBeGreaterThan(1);
    // Каналы независимы: у WhatsApp записи нет.
    expect(settingsOf(BOT).zernio.wizard.whatsapp).toBeUndefined();
  });

  it("повторная проверка на том же шаге ничего не пишет", async () => {
    await startWizard(ctxFor(), "instagram", NOW);
    zernio.accounts = [{ _id: "acc-1", platform: "instagram", profileId: "prof-1" }];
    await checkWizard(ctxFor(), "instagram", { now: at(1) });
    const entry = JSON.stringify(settingsOf(BOT).zernio.wizard);
    await checkWizard(ctxFor(), "instagram", { now: at(2) });
    // Время шага не сдвинулось: запись не перезаписывалась.
    expect(JSON.stringify(settingsOf(BOT).zernio.wizard)).toBe(entry);
  });

  it("аккаунт слетел после готовности — мастер возвращается ко входу, тест начнётся заново", async () => {
    await startWizard(ctxFor(), "instagram", NOW);
    zernio.accounts = [{ _id: "acc-1", platform: "instagram", profileId: "prof-1" }];
    bindWebhook("prof-1");
    await checkWizard(ctxFor(), "instagram", { now: at(1) });
    incoming("instagram", at(2));
    expect((await checkWizard(ctxFor(), "instagram", { now: at(3) })).step).toBe("done");
    zernio.accounts[0]!.isExpired = true;
    const st = await checkWizard(ctxFor(), "instagram", { now: at(4) });
    expect(st).toMatchObject({ step: "login", problem: "expired" });
    expect(settingsOf(BOT).zernio.wizard.instagram.test_at).toBeUndefined();
    expect(settingsOf(BOT).zernio.wizard.instagram.test_since).toBeUndefined();
  });
});

describe("мастер: сбой на шаге и повтор без дублей", () => {
  it("500 на ссылке входа: «не уверены», запись для оператора; повтор даёт ссылку и тот же профиль", async () => {
    zernio.fail = [{ path: "/connect/", status: 500 }];
    const first = await startWizard(ctxFor(), "instagram", NOW);
    expect(first.url).toBeNull();
    expect(first.state).toMatchObject({ step: "login", problem: "unsure" });
    expect(settingsOf(BOT).zernio.wizard.instagram.problem).toBe("unsure");

    const second = await startWizard(ctxFor(), "instagram", at(1));
    expect(second.url).toBe("https://zernio.test/auth/connect/instagram");
    expect(second.state.problem).toBeUndefined();
    expect(zernio.profiles).toHaveLength(1);
    expect(zernio.calls.filter((c) => c === "POST /profiles")).toHaveLength(1);
    // Запись сохранила момент начала, а причина ушла.
    expect(settingsOf(BOT).zernio.wizard.instagram).toMatchObject({
      step: "login",
      started_at: NOW.toISOString(),
    });
    expect(settingsOf(BOT).zernio.wizard.instagram.problem).toBeUndefined();
  });

  it("профиль создан, но ответ потерян (500 после записи): повтор находит его по имени", async () => {
    const calls = zernio.calls;
    // Первый POST выполняется на стороне Zernio, но клиент получает 500.
    let posts = 0;
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
      const res = await real(url, init as never);
      if (
        (init?.method ?? "GET") === "POST" &&
        new URL(url).pathname.endsWith("/profiles") &&
        posts++ === 0
      )
        return new Response("{}", { status: 500 });
      return res;
    });
    const first = await startWizard(ctxFor(), "instagram", NOW);
    expect(first.state).toMatchObject({ step: "login", problem: "unsure" });
    expect(zernio.profiles).toHaveLength(1);

    const second = await startWizard(ctxFor(), "instagram", at(1));
    expect(second.url).toContain("/connect/instagram");
    expect(zernio.profiles).toHaveLength(1);
    expect(calls.filter((c) => c === "POST /profiles")).toHaveLength(1);
  });

  it("503 — «подождите», 403 — «отказ»; причины разные, обе видны оператору", async () => {
    zernio.fail = [{ path: "/connect/", status: 503 }];
    expect((await startWizard(ctxFor(), "instagram", NOW)).state.problem).toBe("try_later");
    zernio.fail = [{ path: "/connect/", status: 403 }];
    expect((await startWizard(ctxFor(), "instagram", at(1))).state.problem).toBe("refused");
    expect(wizardOperatorRows(ctxFor())).toEqual([
      expect.objectContaining({ platform: "instagram", step: "login", problem: "refused" }),
    ]);
  });

  it("аккаунт записан у другого магазина — конфликт, ссылку входа не выдаём", async () => {
    db.tables.bots!.push({
      id: "other",
      settings: {
        served_by: "v2",
        slug: "o",
        zernio: { profile_id: "prof-1", account_ids: ["acc-9"] },
      },
    });
    // Профиль этого магазина уже есть в Zernio, и в нём чужой аккаунт.
    settingsOf(BOT).zernio = { profile_id: "prof-2" };
    zernio.profiles = [{ _id: "prof-2", name: "Магазин · 00000000" }];
    zernio.accounts = [{ _id: "acc-9", platform: "instagram", profileId: "prof-2" }];
    const r = await startWizard(ctxFor(), "instagram", NOW);
    expect(r.url).toBeNull();
    expect(r.state).toMatchObject({ step: "login", problem: "conflict" });
    expect(zernio.calls.some((c) => c.startsWith("GET /connect"))).toBe(false);
  });

  it("на платформе нет ключа Zernio — причина для оператора, в Zernio не ходим", async () => {
    setEnvForTests({ ZERNIO_API_KEY: "" });
    const r = await startWizard(ctxFor(), "whatsapp", NOW);
    expect(r.state).toMatchObject({ step: "login", problem: "not_configured" });
    expect(zernio.calls).toEqual([]);
    expect(settingsOf(BOT).zernio.wizard.whatsapp.problem).toBe("not_configured");
  });
});

describe("мастер и клиент прежней платформы", () => {
  it("served_by v1: ни Zernio, ни записи в settings", async () => {
    const before = JSON.stringify(rowOf(V1));
    const r = await startWizard(ctxFor(V1), "instagram", NOW);
    expect(r.url).toBeNull();
    const c = await checkWizard(ctxFor(V1), "instagram", { create: true, now: NOW });
    expect(c.started).toBe(false);
    expect(zernio.calls).toEqual([]);
    expect(JSON.stringify(rowOf(V1))).toBe(before);
  });

  it("продавец, который не начинал мастер, записи не получает от одного открытия страницы", async () => {
    settingsOf(BOT).zernio = { profile_id: "prof-1" };
    zernio.accounts = [{ _id: "acc-1", platform: "instagram", profileId: "prof-1" }];
    const st = await checkWizard(ctxFor(), "instagram", { now: NOW });
    expect(st.started).toBe(false);
    expect(settingsOf(BOT).zernio.wizard).toBeUndefined();
    expect(wizardSnapshot(ctxFor())).toEqual([]);
  });
});
