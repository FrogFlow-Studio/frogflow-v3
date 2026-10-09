import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { localDay, noticeStaleRate, RATE_STALE_NOTICE_KEY } from "./rate-notice.server";

/** Рубли просят, курса нет: предупреждение продавцу — одно в сутки, и при гонке тоже. */

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

function ctxOf(adminLocale?: string) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]], zernio_logs: [["event_id"]] } });
  db.tables.app_settings = [
    { bot_id: "b", key: "admin_chat_id", value: "900, 901" },
    ...(adminLocale ? [{ bot_id: "b", key: "admin_locale", value: adminLocale }] : []),
  ];
  db.tables.zernio_logs = [];
  const ctx = {
    tenant: { id: "b", settings: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const queued = () => db.tables.zernio_logs!.filter((r) => r.event_type === "outbox.admin_notice");
  return { ctx, db, queued };
}

describe("предупреждение «курса рубля нет»", () => {
  it("два сообщения одновременно — предупреждение одно (на каждого продавца по строке очереди)", async () => {
    const { ctx, queued } = ctxOf();
    const now = new Date("2026-10-07T06:00:00Z");
    const won = await Promise.all([noticeStaleRate(ctx, now), noticeStaleRate(ctx, now)]);
    expect(won.filter(Boolean)).toHaveLength(1);
    expect(queued()).toHaveLength(2);
    expect(JSON.stringify(queued()[0]!.payload)).toContain("Курса рубля для консультанта нет");
  });

  it("в тот же день повторно не шлёт, на следующий день — снова", async () => {
    const { ctx, db, queued } = ctxOf();
    expect(await noticeStaleRate(ctx, new Date("2026-10-07T06:00:00Z"))).toBe(true);
    expect(await noticeStaleRate(ctx, new Date("2026-10-07T15:00:00Z"))).toBe(false);
    expect(queued()).toHaveLength(2);
    expect(await noticeStaleRate(ctx, new Date("2026-10-08T06:00:00Z"))).toBe(true);
    expect(queued()).toHaveLength(4);
    // Отметка — короткая дата, не текст: условие записи на маленьком поле.
    expect(db.tables.app_settings!.find((r) => r.key === RATE_STALE_NOTICE_KEY)?.value).toBe(
      "2026-10-08",
    );
  });

  it("сутки — по поясу магазина: 20:00 UTC 07.10 в Алматы уже 08.10", () => {
    expect(localDay(new Date("2026-10-07T20:00:00Z"), "Asia/Almaty")).toBe("2026-10-08");
  });

  it("на языке продавца", async () => {
    const { ctx, queued } = ctxOf("kk");
    await noticeStaleRate(ctx, new Date("2026-10-07T06:00:00Z"));
    expect(JSON.stringify(queued()[0]!.payload)).toContain("рубль бағамы жоқ");
  });
});
