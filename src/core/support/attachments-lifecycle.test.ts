import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Скриншоты поддержки (П1): ссылка короткая и только на свои ключи, чужой магазин чужого не
 * получает, ретеншн и чистка копий со знаком их не трогают, оператор видит страницу-источник.
 */
const B1 = "11111111-1111-4111-8111-111111111111";
const B2 = "22222222-2222-4222-8222-222222222222";
const KEY1 = `${B1}/0123456789abcdef01234567.png`;
const KEY2 = `${B2}/89abcdef0123456789abcdef.png`;

let db: FakeDb;
const signed: Array<{ key: string; ttl: number }> = [];
const removed: string[] = [];
let stored: { size: number; contentType: string; bytes: number[] } | null = null;
let listed: Array<{ name: string; updated_at: string }> = [];
const storage = {
  from: () => ({
    createSignedUrl: async (key: string, ttl: number) => {
      signed.push({ key, ttl });
      return { data: { signedUrl: `https://files.test/${key}` }, error: null };
    },
    info: async () =>
      stored
        ? { data: { size: stored.size, contentType: stored.contentType }, error: null }
        : { data: null, error: {} },
    download: async () => ({ data: new Blob([new Uint8Array(stored?.bytes ?? [])]), error: null }),
    list: async () => ({ data: listed, error: null }),
    remove: async (keys: string[]) => {
      removed.push(...keys);
      return { error: null };
    },
  }),
};
vi.mock("@/config/env", () => ({ env: () => ({ TELEGRAM_API_BASE: "https://tg" }) }));
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => Object.assign(db, { storage }),
}));
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<object>()),
  tenantDirectory: async () => [
    { id: B1, name: "Лавка", settings: { served_by: "v2" } },
    { id: B2, name: "Пекарня", settings: { served_by: "v2" } },
  ],
}));

const { loadSupport } = await import("./support");
const { supportConversation } = await import("@/app/operator/support.server");
const { pruneStampedCopies } = await import("@/core/delivery/watermark.server");
const { checkChatAttachment } = await import("@/app/admin/chat-attachment.server");
const { runRetention } = await import("@/core/retention/retention");

const seller = (id: string) => ({ tenant: { id, name: id }, db }) as unknown as TenantContext;
const NOW = Date.parse("2026-10-04T00:00:00Z");
const row = (id: string, bot: string, key: string | null, extra = {}) => ({
  id,
  bot_id: bot,
  thread_id: `t-${bot}`,
  author: "seller",
  author_name: "m",
  body: "смотрите",
  attachment_key: key,
  context: null,
  created_at: "2026-09-01T10:00:00Z",
  read_at: null,
  notified_at: null,
  ...extra,
});

beforeEach(() => {
  db = fakeDb();
  signed.length = 0;
  removed.length = 0;
  listed = [];
  stored = null;
});

describe("скриншоты поддержки: доступ", () => {
  it("продавец получает ссылку только на свой скриншот, срок ссылки — минуты", async () => {
    db.tables.platform_messages = [row("m1", B1, KEY1), row("m2", B2, KEY2)];
    const v = await loadSupport(seller(B1));
    expect(v.available && v.messages.map((m) => m.screenshotUrl)).toEqual([
      `https://files.test/${KEY1}`,
    ]);
    expect(signed).toEqual([{ key: KEY1, ttl: 600 }]);
  });

  it("строка с чужим префиксом ключа ссылки не получает", async () => {
    db.tables.platform_messages = [row("m1", B1, KEY2)];
    const v = await loadSupport(seller(B1));
    expect(v.available && v.messages[0]!.screenshotUrl).toBeNull();
    expect(signed).toEqual([]);
  });

  it("оператор видит страницу-источник, номер заказа и скриншот", async () => {
    db.tables.platform_messages = [
      row("m1", B1, KEY1, { context: { page: "/admin/orders/15", order_no: 15 } }),
    ];
    const v = (await supportConversation(B1))!;
    expect(v.messages[0]).toMatchObject({
      screenshotUrl: `https://files.test/${KEY1}`,
      context: { page: "/admin/orders/15", orderNo: 15 },
    });
  });
});

describe("скриншот в обращении: что принимаем (так же проверяет sendSupportMessageFn)", () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const shot = (key: string) => ({ kind: "photo" as const, key, name: "screenshot" });
  const MB = 1024 * 1024;

  it("PNG до 5 МБ проходит", async () => {
    stored = { size: MB, contentType: "image/png", bytes: PNG };
    await expect(checkChatAttachment(seller(B1), shot(KEY1))).resolves.toMatchObject({
      key: KEY1,
    });
  });

  it("больше 5 МБ, не картинка, чужой магазин, не выданный ключ, нет файла — отказ", async () => {
    stored = { size: 6 * MB, contentType: "image/png", bytes: PNG };
    await expect(checkChatAttachment(seller(B1), shot(KEY1))).rejects.toMatchObject({
      key: "err.admin.chatAttachmentBad",
    });
    stored = { size: MB, contentType: "text/html", bytes: PNG };
    await expect(checkChatAttachment(seller(B1), shot(KEY1))).rejects.toMatchObject({
      key: "err.admin.chatAttachmentBad",
    });
    // Под видом PNG лежит страница.
    stored = { size: MB, contentType: "image/png", bytes: [0x3c, 0x68, 0x74, 0x6d, 0x6c] };
    await expect(checkChatAttachment(seller(B1), shot(KEY1))).rejects.toMatchObject({
      key: "err.admin.chatAttachmentBad",
    });
    stored = { size: MB, contentType: "image/png", bytes: PNG };
    await expect(checkChatAttachment(seller(B1), shot(KEY2))).rejects.toMatchObject({
      key: "err.admin.chatAttachmentBad",
    });
    await expect(checkChatAttachment(seller(B1), shot(`${B1}/мой-файл.png`))).rejects.toMatchObject(
      { key: "err.admin.chatAttachmentBad" },
    );
    stored = null;
    await expect(checkChatAttachment(seller(B1), shot(KEY1))).rejects.toMatchObject({
      key: "err.upload.notStored",
    });
  });
});

describe("скриншоты поддержки: не удаляются раньше срока", () => {
  const old = "2026-01-01T00:00:00Z";

  it("чистка копий со знаком убирает только свои старые копии из /wm/, скриншот не трогает", async () => {
    listed = [
      { name: "0123456789abcdef01234567.png", updated_at: old },
      { name: "12-0123456789abcdef.pdf", updated_at: old },
    ];
    const r = await pruneStampedCopies([B1], NOW, { storage: storage as never, db: db as never });
    expect(r.deleted).toBe(1);
    expect(removed).toEqual([`${B1}/wm/12-0123456789abcdef.pdf`]);
    expect(removed).not.toContain(KEY1);
  });

  it("ретеншн не чистит переписку с поддержкой, как бы стара она ни была", async () => {
    db.tables.platform_messages = [row("m1", B1, KEY1, { created_at: "2024-01-01T00:00:00Z" })];
    db.tables.platform_threads = [{ id: "t-1", bot_id: B1, status: "resolved" }];
    const res = await runRetention(NOW, 40_000, [B1]);
    expect(Object.keys(res).filter((k) => /platform|support/i.test(k))).toEqual([]);
    expect(db.tables.platform_messages).toHaveLength(1);
    expect(db.tables.platform_threads).toHaveLength(1);
    expect(removed).not.toContain(KEY1);
  });
});
