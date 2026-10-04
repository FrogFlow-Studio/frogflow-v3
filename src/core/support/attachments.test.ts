import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/** Скриншот и контекст сообщения поддержки: чужое недоступно, лишнее отбрасывается. */
const signed: string[] = [];
let failSign = false;
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (key: string) => {
          if (failSign) throw new Error("storage down");
          signed.push(key);
          return { data: { signedUrl: `https://files.test/${key}?t=1` }, error: null };
        },
      }),
    },
  }),
}));

const { cleanContext, isOwnScreenshotKey, readContext, signScreenshots } =
  await import("./attachments");
const { loadSupport, sendSellerMessage } = await import("./support");

const KEY = "0123456789abcdef01234567";
const ctxFor = (id: string, db: FakeDb) =>
  ({ tenant: { id, name: id }, db }) as unknown as TenantContext;

beforeEach(() => {
  signed.length = 0;
  failSign = false;
});

describe("ключ скриншота", () => {
  it("свой выданный ключ-картинка проходит, чужой префикс, не картинка и «..» — нет", () => {
    expect(isOwnScreenshotKey("b1", `b1/${KEY}.png`)).toBe(true);
    expect(isOwnScreenshotKey("b1", `b1/${KEY}.jpg`)).toBe(true);
    expect(isOwnScreenshotKey("b1", `b2/${KEY}.png`)).toBe(false);
    expect(isOwnScreenshotKey("b1", `b1/${KEY}.pdf`)).toBe(false);
    expect(isOwnScreenshotKey("b1", `b1/../b2/${KEY}.png`)).toBe(false);
    expect(isOwnScreenshotKey("b1", `b1/мой-файл.png`)).toBe(false);
  });
});

describe("контекст сообщения", () => {
  it("страница админки без запроса и якоря, номер заказа — натуральное число", () => {
    expect(cleanContext({ page: "/admin/orders/15?tab=1#x", orderNo: 15 })).toEqual({
      page: "/admin/orders/15",
      order_no: 15,
    });
    expect(cleanContext({ page: "/admin" })).toEqual({ page: "/admin", order_no: null });
  });
  it("чужие адреса, длинные строки и мусор отбрасываются", () => {
    expect(cleanContext({ page: "https://evil.test/admin", orderNo: -3 })).toBeNull();
    expect(cleanContext({ page: "/operator/clients", orderNo: 1.5 })).toBeNull();
    expect(cleanContext({ page: `/admin/${"а".repeat(10)}` })).toBeNull();
    expect(cleanContext({ page: "/admin/" + "a".repeat(300) })).toBeNull();
    expect(cleanContext(null)).toBeNull();
  });
  it("читается обратно", () => {
    expect(readContext({ page: "/admin/chat", order_no: 7 })).toEqual({
      page: "/admin/chat",
      orderNo: 7,
    });
    expect(readContext({ page: null, order_no: null })).toBeNull();
    expect(readContext(null)).toBeNull();
  });
});

describe("ссылки на скриншоты", () => {
  const row = (id: string, bot: string, key: string | null) =>
    ({ id, bot_id: bot, attachment_key: key }) as never;

  it("подписываются только ключи под префиксом автора сообщения", async () => {
    const urls = await signScreenshots([
      row("m1", "b1", `b1/${KEY}.png`),
      row("m2", "b1", `b2/${KEY}.png`),
      row("m3", "b1", null),
    ]);
    expect([...urls.keys()]).toEqual(["m1"]);
    expect(signed).toEqual([`b1/${KEY}.png`]);
  });

  it("сбой хранилища не ломает чат: картинки нет, переписка читается", async () => {
    failSign = true;
    expect((await signScreenshots([row("m1", "b1", `b1/${KEY}.png`)])).size).toBe(0);
  });
});

describe("отправка со скриншотом", () => {
  it("скриншот без текста принимается, контекст и ключ сохраняются, ссылка выдаётся", async () => {
    const db = fakeDb();
    await sendSellerMessage(ctxFor("b1", db), {
      body: "",
      authorName: "m",
      attachmentKey: `b1/${KEY}.png`,
      context: { page: "/admin/orders/15", orderNo: 15 },
    });
    expect(db.tables.platform_messages![0]).toMatchObject({
      attachment_key: `b1/${KEY}.png`,
      context: { page: "/admin/orders/15", order_no: 15 },
    });
    const v = await loadSupport(ctxFor("b1", db));
    const m = v.available && v.messages[0]!;
    expect(m && m.screenshotUrl).toContain(`b1/${KEY}.png`);
    expect(m && m.context).toEqual({ page: "/admin/orders/15", orderNo: 15 });
  });

  it("чужой ключ отклоняется, сообщение не пишется", async () => {
    const db = fakeDb();
    await expect(
      sendSellerMessage(ctxFor("b1", db), {
        body: "смотрите",
        authorName: "m",
        attachmentKey: `b2/${KEY}.png`,
      }),
    ).rejects.toMatchObject({ key: "err.support.attachBad" });
    expect(db.tables.platform_messages ?? []).toHaveLength(0);
    expect(db.tables.platform_threads ?? []).toHaveLength(0);
  });

  it("без текста и без вложения по-прежнему нельзя", async () => {
    await expect(
      sendSellerMessage(ctxFor("b1", fakeDb()), { body: "  ", authorName: "m" }),
    ).rejects.toMatchObject({ key: "err.support.empty" });
  });
});
