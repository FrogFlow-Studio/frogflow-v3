import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import { findAdminLogin } from "@/core/auth/roles";
import { verifyPassword } from "@/app/auth/password";

/**
 * Приглашение в команду по ссылке: одноразовое, со сроком, настоящий путь
 * (директория арендаторов, условная запись по settings.rev, вход под новым логином).
 */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));

const { createInvite, acceptInvite, inviteInfo, listInvites, revokeInvite } =
  await import("./team-invite.server");
const { tenantContext, tenantDirectory, resolveTenant, invalidateTenantDirectory } =
  await import("@/core/tenant/resolve.server");

const BOT = "00000000-0000-4000-8000-0000000000aa";
const NOW = Date.parse("2026-10-04T10:00:00Z");
const DAY = 86_400_000;

const settings = () => db.tables.bots![0]!.settings as Record<string, unknown>;
const admin = () =>
  settings().admin as { users?: Array<Record<string, unknown>>; invites?: unknown[] };
const secretOf = (link: string) => new URL(link).searchParams.get("t")!;

async function owner() {
  invalidateTenantDirectory();
  const t = await resolveTenant({ by: "id", value: BOT });
  return tenantContext(t!);
}

function seed() {
  invalidateTenantDirectory();
  db = fakeDb();
  db.tables.bots = [
    {
      id: BOT,
      bot_name: "Лавка",
      status: "active",
      vertical: "digital",
      modules: { shop: true, admin_roles: true },
      settings: {
        rev: 3,
        served_by: "v2",
        slug: "lavka",
        admin: { username: "owner", password_hash: "scrypt$a$b" },
      },
    },
  ];
  db.tables.bot_events = [];
}

beforeEach(() => {
  setEnvForTests({});
  seed();
});

describe("приглашение в команду", () => {
  it("ссылка одна, в настройках только хеш, срок 7 дней", async () => {
    const { link, expiresAt } = await createInvite(
      await owner(),
      "owner",
      { role: "manager" },
      NOW,
    );
    const secret = secretOf(link);
    expect(link).toContain(`/admin/invite?b=${BOT}&t=`);
    expect(JSON.stringify(settings())).not.toContain(secret);
    expect(Date.parse(expiresAt)).toBe(NOW + 7 * DAY);
    expect(admin().invites).toHaveLength(1);
    expect(settings().rev).toBe(4);
    expect(listInvites(await owner(), NOW)).toMatchObject([{ role: "manager", name: null }]);
  });

  it("принято: создан менеджер, приглашение погашено, под логином можно войти, в журнале запись", async () => {
    const { link } = await createInvite(
      await owner(),
      "owner",
      { role: "manager", name: "Анна" },
      NOW,
    );
    const secret = secretOf(link);
    expect(await inviteInfo(BOT, secret, NOW + 1000)).toEqual({
      shop: "Лавка",
      role: "manager",
      name: "Анна",
    });
    expect(
      await acceptInvite(
        BOT,
        secret,
        { username: "Anna_K", password: "correct-horse" },
        NOW + 1000,
      ),
    ).toBe(true);
    const user = admin().users![0]!;
    expect(user).toMatchObject({ username: "anna_k", role: "manager", name: "Анна" });
    expect(verifyPassword("correct-horse", user.password_hash as string)).toBe(true);
    expect(admin().invites).toEqual([]);
    invalidateTenantDirectory();
    const login = findAdminLogin(await tenantDirectory(true), "anna_k");
    expect(login).toMatchObject({ role: "manager", name: "Анна" });
    expect(login!.tenant.id).toBe(BOT);
    expect(db.tables.bot_events).toMatchObject([
      {
        bot_id: BOT,
        actor: "admin:anna_k",
        payload: { action: "inviteAccepted", role: "manager" },
      },
    ]);
    expect(
      await acceptInvite(
        BOT,
        secret,
        { username: "second_user", password: "correct-horse" },
        NOW + 2000,
      ),
    ).toBe(false);
    expect(await inviteInfo(BOT, secret, NOW + 2000)).toBeNull();
  });

  it("гонка: два одновременных принятия — проходит одно, пользователь один", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "accountant" }, NOW);
    const secret = secretOf(link);
    const results = await Promise.all([
      acceptInvite(BOT, secret, { username: "first_user", password: "password-1" }, NOW + 1),
      acceptInvite(BOT, secret, { username: "second_user", password: "password-2" }, NOW + 1),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(admin().users).toHaveLength(1);
    expect(admin().users![0]!.role).toBe("accountant");
    expect(db.tables.bot_events).toHaveLength(1);
  });

  it("просроченное не принимается", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "viewer" }, NOW);
    const secret = secretOf(link);
    const late = NOW + 7 * DAY + 1;
    expect(await inviteInfo(BOT, secret, late)).toBeNull();
    expect(
      await acceptInvite(BOT, secret, { username: "late_user", password: "password-1" }, late),
    ).toBe(false);
    expect(admin().users ?? []).toEqual([]);
  });

  it("чужой секрет и отозванное приглашение не работают", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "manager" }, NOW);
    const secret = secretOf(link);
    expect(
      await acceptInvite(
        BOT,
        "x".repeat(32),
        { username: "intruder", password: "password-1" },
        NOW,
      ),
    ).toBe(false);
    const [pending] = listInvites(await owner(), NOW);
    await revokeInvite(await owner(), pending!.id);
    expect(
      await acceptInvite(BOT, secret, { username: "revoked_user", password: "password-1" }, NOW),
    ).toBe(false);
    expect(admin().users ?? []).toEqual([]);
  });

  it("занятый логин не сжигает приглашение", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "manager" }, NOW);
    const secret = secretOf(link);
    await expect(
      acceptInvite(BOT, secret, { username: "owner", password: "password-1" }, NOW),
    ).rejects.toMatchObject({ key: "err.admin.loginTaken" });
    expect(admin().invites).toHaveLength(1);
    expect(
      await acceptInvite(BOT, secret, { username: "free_login", password: "password-1" }, NOW),
    ).toBe(true);
  });

  it("клиент прежней платформы и магазин без модуля команды ссылку не принимают", async () => {
    const { link } = await createInvite(await owner(), "owner", { role: "manager" }, NOW);
    const secret = secretOf(link);
    (settings() as { served_by?: string }).served_by = "v1";
    invalidateTenantDirectory();
    expect(
      await acceptInvite(BOT, secret, { username: "from_v1", password: "password-1" }, NOW),
    ).toBe(false);
    (settings() as { served_by?: string }).served_by = "v2";
    (db.tables.bots![0]!.modules as Record<string, boolean>).admin_roles = false;
    invalidateTenantDirectory();
    expect(await inviteInfo(BOT, secret, NOW)).toBeNull();
  });

  it("не больше 20 приглашений сразу; просроченные при этом не считаются", async () => {
    for (let i = 0; i < 20; i++)
      await createInvite(await owner(), "owner", { role: "viewer" }, NOW);
    await expect(
      createInvite(await owner(), "owner", { role: "viewer" }, NOW),
    ).rejects.toMatchObject({ key: "err.admin.inviteLimit" });
    expect(admin().invites).toHaveLength(20);
    await createInvite(await owner(), "owner", { role: "viewer" }, NOW + 8 * DAY);
    expect(admin().invites).toHaveLength(1);
  });

  it("чужие ключи settings запись не затирает", async () => {
    await createInvite(await owner(), "owner", { role: "manager" }, NOW);
    expect(settings()).toMatchObject({ served_by: "v2", slug: "lavka" });
    expect((settings().admin as { username: string }).username).toBe("owner");
  });
});
