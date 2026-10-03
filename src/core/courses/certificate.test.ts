import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, type Course } from "./course";
import { CERT_CODE_RE, certificateReady, certificateNo } from "./certificate";
import { hwKey } from "./homework";
import { runKey, type CoursePurchase } from "./run.server";

const { certificateByCode, certificateOf, issueCertificate } = await import("./certificate.server");
const { certificatePdf } = await import("./certificate-pdf.server");

/** Сертификат: когда курс пройден, один раз на покупку, подлинность по коду, PDF с кириллицей. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const L1 = "00000000-0000-4000-8000-000000000001";
const L2 = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-10T10:00:00Z");

describe("certificateReady", () => {
  const lessons = [
    { id: L1, homework: "Круг" },
    { id: L2, homework: null },
  ];
  const base = {
    lessons,
    open: new Set([L1, L2]),
    done: new Set<string>(),
    homework: new Map<string, "submitted" | "accepted" | "revise">(),
    checksHomework: true,
  };
  it("все ДЗ приняты и уроки открыты — готов; на проверке или доработке — нет", () => {
    expect(certificateReady({ ...base, homework: new Map([[L1, "accepted"]]) })).toBe(true);
    expect(certificateReady({ ...base, homework: new Map([[L1, "submitted"]]) })).toBe(false);
    expect(certificateReady({ ...base, homework: new Map([[L1, "revise"]]) })).toBe(false);
    expect(certificateReady(base)).toBe(false);
  });
  it("неоткрытый урок — курс не окончен", () => {
    expect(
      certificateReady({ ...base, open: new Set([L1]), homework: new Map([[L1, "accepted"]]) }),
    ).toBe(false);
  });
  it("тариф без проверки ДЗ или курс без заданий — нужны отметки «пройден»", () => {
    expect(certificateReady({ ...base, checksHomework: false })).toBe(false);
    expect(certificateReady({ ...base, checksHomework: false, done: new Set([L1, L2]) })).toBe(
      true,
    );
    expect(
      certificateReady({ ...base, lessons: [{ id: L2, homework: null }], done: new Set([L2]) }),
    ).toBe(true);
    expect(certificateReady({ ...base, lessons: [] })).toBe(false);
  });
});

function school(accepted: boolean) {
  const course: Course = {
    schedule: { mode: "all" },
    lessons: [{ id: L1, title: "Кисти", text: "т", files: [], link: null, homework: "Круг" }],
  };
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.orders = [
    { id: 5, display_name: "Айгерим Қасымова", username: null, user_key: "tg_1" },
  ];
  db.tables.app_settings = [
    { bot_id: T, key: courseKey(P), value: JSON.stringify(course) },
    {
      bot_id: T,
      key: runKey(ITEM),
      value: JSON.stringify({ startedAt: "2026-10-01T00:00:00Z", done: [] }),
    },
    {
      bot_id: T,
      key: hwKey(ITEM, L1),
      value: JSON.stringify({
        rev: 2,
        orderItemId: ITEM,
        lessonId: L1,
        productId: P,
        course: "Аквагрим",
        lessonNo: 1,
        lessonTitle: "Кисти",
        student: "Айгерим",
        status: accepted ? "accepted" : "submitted",
        attempts: [{ at: "2026-10-02T00:00:00Z", text: "ок", files: [] }],
        feedback: null,
        updatedAt: "2026-10-02T00:00:00Z",
      }),
    },
  ];
  const ctx = {
    tenant: { id: T, modules: { courses: true }, settings: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const p: CoursePurchase = {
    orderItemId: ITEM,
    orderId: 5,
    telegramId: 42,
    boughtAt: "2026-10-01T00:00:00Z",
    variantId: null,
    productId: P,
    name: "Аквагрим для начинающих",
    course,
    run: null,
  };
  return { ctx, p };
}

describe("выдача сертификата", () => {
  it("не принято ДЗ — сертификата нет", async () => {
    const { ctx, p } = school(false);
    expect(await issueCertificate(ctx, p, NOW)).toBeNull();
    expect(await certificateOf(ctx, ITEM)).toBeNull();
  });

  it("принято — выдан с номером и кодом; повтор отдаёт тот же, не создавая второй", async () => {
    const { ctx, p } = school(true);
    const first = await issueCertificate(ctx, p, NOW);
    expect(first?.created).toBe(true);
    expect(first?.certificate).toMatchObject({
      no: 1,
      student: "Айгерим Қасымова",
      course: "Аквагрим для начинающих",
    });
    expect(first?.certificate.code).toMatch(CERT_CODE_RE);
    const again = await issueCertificate(ctx, p, new Date(NOW.getTime() + 86400_000));
    expect(again).toEqual({ certificate: first!.certificate, created: false });
    expect(certificateNo(1)).toBe("000001");
    expect(await certificateByCode(ctx, first!.certificate.code)).toEqual(first!.certificate);
    expect(await certificateByCode(ctx, "ZZZZZZZZZZZZ")).toBeNull();
  });

  it("семь одновременных запросов — один сертификат и одна выдача", async () => {
    const { ctx, p } = school(true);
    const all = await Promise.all(Array.from({ length: 7 }, () => issueCertificate(ctx, p, NOW)));
    expect(new Set(all.map((r) => r?.certificate.code)).size).toBe(1);
    expect(all.filter((r) => r?.created)).toHaveLength(1);
    const rows = (ctx.db as unknown as { tables: Record<string, Array<{ key: string }>> }).tables
      .app_settings!;
    const records = rows.filter((r) => /^course_cert_[2-9A-HJ-NP-Z]{12}$/.test(r.key));
    expect(records).toHaveLength(1);
  });
});

describe("PDF сертификата", () => {
  it("собирается с кириллицей и казахскими буквами на каждом языке магазина", async () => {
    const { ctx, p } = school(true);
    const cert = (await issueCertificate(ctx, p, NOW))!.certificate;
    for (const locale of ["ru", "kk", "en", "uz"] as const) {
      const pdf = await certificatePdf(cert, {
        locale,
        timezone: "Asia/Almaty",
        shop: "Школа Анастасии",
        url: "https://school.test/cert/" + cert.code,
      });
      expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(5_000);
    }
  });
});
