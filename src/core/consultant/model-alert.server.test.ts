import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  alertSellerModelFailure,
  SELLER_ALERT_EVERY_MS,
  SELLER_MODEL_ALERT_KEY,
  sellerModelAlertText,
} from "./model-alert.server";
import { SUPPORTED_LOCALES as LOCALES } from "@/core/i18n/locale";

/**
 * Продавцу о долгом сбое ИИ (v1 consultant-v2/model-alert.ts): деньги или
 * ключ — сообщение, перегрузка — нет; не чаще раза в три часа на вид сбоя,
 * из двух сообщений подряд — одно.
 */
const now = Date.parse("2026-10-07T08:00:00Z");

function ctxOf(lastError: string | null) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    ...(lastError ? [{ bot_id: "b1", key: "consultant_last_error", value: lastError }] : []),
    { bot_id: "b1", key: "admin_locale", value: "ru" },
  ];
  const ctx = {
    tenant: { id: "b1", settings: {}, modules: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { ctx, db };
}

const billing = `${new Date(now - 60_000).toISOString()} — HTTP 400: Your credit balance is too low to access the Anthropic API.`;

describe("сбой ИИ — продавцу", () => {
  it("кончились деньги — одно сообщение, повтор в течение трёх часов молчит", async () => {
    const { ctx, db } = ctxOf(billing);
    const sent: string[] = [];
    const notify = async (html: string) => (sent.push(html), 1);
    expect(await alertSellerModelFailure(ctx, notify, now)).toBe("sent");
    expect(sent[0]).toContain("ИИ-консультант временно не отвечает");
    expect(await alertSellerModelFailure(ctx, notify, now + 60_000)).toBe("throttled");
    expect(sent).toHaveLength(1);
    const mark = db.tables.app_settings!.find((r) => r.key === SELLER_MODEL_ALERT_KEY);
    expect(JSON.parse(String(mark!.value))).toEqual({ billing: new Date(now).toISOString() });
    // Через три часа сбой всё ещё есть — напоминаем.
    const later = now + SELLER_ALERT_EVERY_MS + 1000;
    db.tables.app_settings!.find((r) => r.key === "consultant_last_error")!.value =
      `${new Date(later - 1000).toISOString()} — HTTP 400: credit balance is too low`;
    expect(await alertSellerModelFailure(ctx, notify, later)).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("два сообщения одновременно — одно уведомление", async () => {
    const { ctx } = ctxOf(billing);
    const sent: string[] = [];
    const notify = async (html: string) => (sent.push(html), 1);
    const r = await Promise.all([
      alertSellerModelFailure(ctx, notify, now),
      alertSellerModelFailure(ctx, notify, now),
    ]);
    expect(sent).toHaveLength(1);
    expect(r.sort()).toEqual(["sent", "throttled"]);
  });

  it("перегрузка, 5xx, старый сбой или без сбоя — не пишем", async () => {
    const notify = async () => 1;
    for (const err of [
      `${new Date(now - 60_000).toISOString()} — HTTP 529: Overloaded`,
      `${new Date(now - 60_000).toISOString()} — HTTP 500: Internal`,
      `${new Date(now - SELLER_ALERT_EVERY_MS - 60_000).toISOString()} — HTTP 401: invalid x-api-key`,
      null,
    ]) {
      const { ctx } = ctxOf(err);
      expect(await alertSellerModelFailure(ctx, notify, now)).toBe("none");
    }
  });

  it("ключ не принят — свой текст", async () => {
    const { ctx } = ctxOf(`${new Date(now).toISOString()} — HTTP 401: invalid x-api-key`);
    const sent: string[] = [];
    expect(await alertSellerModelFailure(ctx, async (h) => (sent.push(h), 1), now)).toBe("sent");
    expect(sent[0]).toContain("не принимает ключ");
  });

  it("тексты на четырёх языках", () => {
    for (const l of LOCALES)
      for (const k of ["billing", "auth", "no_key", "limit"] as const)
        expect(sellerModelAlertText(l, k).length).toBeGreaterThan(20);
    expect(sellerModelAlertText("en", "billing")).toMatch(/AI consultant/);
  });
});
