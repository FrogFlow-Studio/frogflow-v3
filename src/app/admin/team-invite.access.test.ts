import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";

/**
 * Приглашение команды как публичная точка входа (З2): без сессии секрет ссылки — единственное, что
 * открывает запись. Настоящие серверные функции: createServerFn зовёт обработчик напрямую, база
 * подставная, справочник арендаторов и условная запись по settings.rev — настоящие.
 */
vi.mock("@tanstack/react-start", () => ({
  createServerFn: (opts?: { method?: string }) => {
    let parse: (d: unknown) => unknown = (d) => d;
    const b = {
      validator(v: (d: unknown) => unknown) {
        parse = v;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        const run = (a: { data: unknown }) => h({ data: parse(a.data) });
        (run as unknown as { method: string }).method = opts?.method ?? "GET";
        return run;
      },
    };
    return b;
  },
}));
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));

const { createInvite, acceptInvite, inviteInfo, listInvites, revokeInvite } =
  await import("./team-invite.server");
const { acceptStaffInviteFn, staffInviteInfoFn } = await import("./team-invite.functions");
const { tenantContext, resolveTenant, invalidateTenantDirectory } =
  await import("@/core/tenant/resolve.server");

const BOT = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const NOW = Date.now();
const DAY = 86_400_000;
const secretOf = (link: string) => new URL(link).searchParams.get("t")!;
const settings = (id = BOT) =>
  db.tables.bots!.find((b) => b.id === id)!.settings as Record<string, unknown>;
const admin = (id = BOT) => settings(id).admin as { users?: Array<Record<string, unknown>> };

const bot = (id: string, username: string) => ({
  id,
  bot_name: `Магазин ${username}`,
  status: "active",
  vertical: "digital",
  modules: { shop: true, admin_roles: true },
  settings: {
    rev: 1,
    served_by: "v2",
    slug: username,
    admin: { username, password_hash: "s$a$b" },
  },
});

async function owner(id = BOT) {
  invalidateTenantDirectory();
  return tenantContext((await resolveTenant({ by: "id", value: id }))!);
}

beforeEach(() => {
  setEnvForTests({});
  invalidateTenantDirectory();
  db = fakeDb();
  db.tables.bots = [bot(BOT, "lavka"), bot(OTHER, "other_shop")];
  db.tables.bot_events = [];
});

const accept = (b: string, t: string, over: Record<string, unknown> = {}) =>
  acceptStaffInviteFn({
    data: { b, t, username: "new_user", password: "correct-horse", ...over },
  } as never) as Promise<{ ok: boolean }>;
const info = (b: string, t: string) =>
  staffInviteInfoFn({ data: { b, t } } as never) as Promise<{ ok: boolean }>;

describe("приглашение команды: нет приглашения — один ответ", () => {
  it("неверный, чужого магазина, отозванный и просроченный секрет отвечают одинаково", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "manager" }, NOW);
    const secret = secretOf(link);
    const [pending] = listInvites(await owner(), NOW);
    const expired = await createInvite(await owner(), "owner", { role: "viewer" }, NOW - 8 * DAY);
    await revokeInvite(await owner(), pending!.id);
    const dead = [
      "x".repeat(32), // неверный
      secret, // отозванный
      secretOf(expired.link), // просроченный
      "short-secret-1",
    ];
    for (const t of dead) {
      expect(await info(BOT, t), t).toEqual({ ok: false });
      expect(await accept(BOT, t), t).toEqual({ ok: false });
    }
    // Секрет, действующий в другом магазине, чужому не подходит.
    const live = await createInvite(await owner(OTHER), "owner", { role: "manager" }, NOW);
    expect(await info(BOT, secretOf(live.link))).toEqual({ ok: false });
    expect(await accept(BOT, secretOf(live.link))).toEqual({ ok: false });
    expect(admin().users ?? []).toEqual([]);
    expect(admin(OTHER).users ?? []).toEqual([]);
  });

  it("без действующего приглашения логин не проверяется: «занят» и «неверный вид» не выдаются", async () => {
    // Занятый логин (владелец другого магазина), короткий пароль и неверный вид логина.
    for (const over of [
      { username: "other_shop" },
      { username: "owner" },
      { username: "Не логин!" },
    ])
      expect(await accept(BOT, "x".repeat(32), over), JSON.stringify(over)).toEqual({ ok: false });
  });

  it("с действующим приглашением занятый логин сообщается, а приглашение остаётся", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "manager" }, NOW);
    await expect(accept(BOT, secretOf(link), { username: "other_shop" })).rejects.toMatchObject({
      key: "err.admin.loginTaken",
    });
    expect(await accept(BOT, secretOf(link))).toEqual({ ok: true });
  });
});

describe("приглашение команды: роль и одноразовость", () => {
  it("роль берётся из приглашения: лишние поля запроса её не поднимают", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "viewer" }, NOW);
    const r = await accept(BOT, secretOf(link), { role: "owner", admin: true, isOwner: true });
    expect(r).toEqual({ ok: true });
    expect(admin().users).toHaveLength(1);
    expect(admin().users![0]).toMatchObject({ username: "new_user", role: "viewer" });
    expect(Object.keys(admin().users![0]!).sort()).toEqual(
      ["created_at", "name", "password_hash", "role", "username"].filter(
        (k) => k in admin().users![0]!,
      ),
    );
  });

  it("принять можно один раз: повтор той же ссылкой — отказ", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "manager" }, NOW);
    expect(await accept(BOT, secretOf(link))).toEqual({ ok: true });
    expect(await accept(BOT, secretOf(link), { username: "second_user" })).toEqual({ ok: false });
    expect(await info(BOT, secretOf(link))).toEqual({ ok: false });
    expect(admin().users).toHaveLength(1);
  });

  it("гонка на настоящей функции: пять одновременных принятий — один участник", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "accountant" }, NOW);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => accept(BOT, secretOf(link), { username: `user_${i}` })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(admin().users).toHaveLength(1);
    expect(admin().users![0]!.role).toBe("accountant");
    expect(db.tables.bot_events).toHaveLength(1);
  });

  it("действует ровно 7 дней", async () => {
    const { link, expiresAt } = await createInvite(await owner(), "owner", { role: "viewer" }, NOW);
    expect(Date.parse(expiresAt) - NOW).toBe(7 * DAY);
    const secret = secretOf(link);
    expect(await inviteInfo(BOT, secret, NOW + 7 * DAY - 1)).not.toBeNull();
    expect(await inviteInfo(BOT, secret, NOW + 7 * DAY)).toBeNull();
    expect(
      await acceptInvite(BOT, secret, { username: "late", password: "password-1" }, NOW + 7 * DAY),
    ).toBe(false);
  });
});

describe("приглашение команды: секрет не утекает", () => {
  it("в настройках и журнале только хеш: ни секрета, ни ссылки", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "manager" }, NOW);
    const secret = secretOf(link);
    await accept(BOT, secret);
    for (const store of [db.tables.bots, db.tables.bot_events, db.tables.zernio_logs ?? []]) {
      const dump = JSON.stringify(store);
      expect(dump).not.toContain(secret);
      expect(dump).not.toContain(link);
    }
  });

  it("обе публичные функции — POST: секрет не попадает в адрес запроса, а значит и в журналы адресов", () => {
    expect((staffInviteInfoFn as unknown as { method: string }).method).toBe("POST");
    expect((acceptStaffInviteFn as unknown as { method: string }).method).toBe("POST");
    const src = readFileSync("src/app/admin/team-invite.functions.ts", "utf8");
    for (const name of ["staffInviteInfoFn", "acceptStaffInviteFn"])
      expect(src).toMatch(
        new RegExp(`export const ${name} = createServerFn\\(\\{ method: "POST" \\}\\)`),
      );
  });

  it("страница ссылки не индексируется", () => {
    expect(readFileSync("src/routes/admin.invite.tsx", "utf8")).toContain('"noindex"');
  });
});
