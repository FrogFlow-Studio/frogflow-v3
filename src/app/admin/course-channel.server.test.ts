import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";

let member: Record<string, unknown> = {};
let chatOk = true;
vi.mock("@/channels/telegram/api", () => ({
  telegramApi: () => ({
    call: async (method: string) => {
      if (method === "getMe") return { ok: true, result: { id: 7 } };
      if (method === "getChat")
        return chatOk ? { ok: true, result: { title: "Клуб школы" } } : { ok: false };
      if (method === "getChatMember") return { ok: true, result: member };
      return { ok: false };
    },
  }),
}));
const { checkCourseChannel } = await import("./course-channel.server");

/** Канал курса в карточке товара: бот видит его и может приглашать. */
const ctx = (token = true) =>
  ({
    secrets: {
      telegramToken: () => {
        if (!token) throw new Error("нет токена");
        return "t";
      },
    },
  }) as unknown as TenantContext;

beforeAll(() => setEnvForTests({}));
afterAll(() => setEnvForTests(undefined));

describe("проверка канала курса", () => {
  it("бот — администратор с правом приглашать: канал подключён", async () => {
    chatOk = true;
    member = { status: "administrator", can_invite_users: true };
    expect(await checkCourseChannel(ctx(), " -1001234567890 ")).toEqual({
      ok: true,
      title: "Клуб школы",
    });
  });

  it("называет, что исправить", async () => {
    chatOk = true;
    member = { status: "member" };
    expect(await checkCourseChannel(ctx(), "@school_club")).toMatchObject({ reason: "notAdmin" });
    member = { status: "administrator", can_invite_users: false };
    expect(await checkCourseChannel(ctx(), "@school_club")).toMatchObject({
      reason: "cannotInvite",
    });
    chatOk = false;
    expect(await checkCourseChannel(ctx(), "@school_club")).toMatchObject({ reason: "notFound" });
    expect(await checkCourseChannel(ctx(), "school")).toMatchObject({ reason: "badId" });
    expect(await checkCourseChannel(ctx(false), "@school_club")).toMatchObject({ reason: "noBot" });
  });
});
