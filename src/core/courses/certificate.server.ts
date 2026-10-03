import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, updateSettingAtomic } from "@/core/settings/settings";
import {
  certificateReady,
  newCertificateCode,
  parseCertificate,
  type Certificate,
} from "./certificate";
import { purchaseHomework, studentName } from "./homework.server";
import { parseRun, purchaseTimeline, type CoursePurchase } from "./run.server";
import { runKey } from "./run.server";

/**
 * Выдача сертификата. «Один раз на покупку»: код ложится в
 * `app_settings.course_certi_<позиция>` условной записью, и только выигравший
 * выдаёт номер и записывает сертификат `course_cert_<код>`. Номер — общий
 * счётчик магазина `course_cert_no`. Повтор, двойной клик, два запроса
 * одновременно получают тот же сертификат.
 */
export const CERT_KEY_PREFIX = "course_cert_";
export const CERT_ITEM_PREFIX = "course_certi_";
const certKey = (code: string) => `${CERT_KEY_PREFIX}${code}`;
const itemKey = (orderItemId: string) => `${CERT_ITEM_PREFIX}${orderItemId}`;
const NO_KEY = "course_cert_no";

/** Курс пройден? Читает прохождение и сдачи, ничего не пишет. */
export async function courseFinished(
  ctx: TenantContext,
  p: CoursePurchase,
  now = new Date(),
): Promise<boolean> {
  const run = parseRun(await getSetting(ctx, runKey(p.orderItemId)));
  if (!run) return false;
  const tl = purchaseTimeline(ctx, { ...p, run }, now);
  const hw = p.course.lessons.some((l) => l.homework)
    ? await purchaseHomework(ctx, p.orderItemId)
    : new Map();
  return certificateReady({
    lessons: p.course.lessons.map((l) => ({ id: l.id, homework: l.homework ?? null })),
    open: new Set(tl.access.filter((a) => a.open).map((a) => a.lesson.id)),
    done: new Set(run.done),
    homework: new Map([...hw].map(([id, h]) => [id, h.status])),
    checksHomework: tl.tariff.homework,
  });
}

/** Уже выданный сертификат покупки; нет — null. */
export async function certificateOf(
  ctx: TenantContext,
  orderItemId: string,
): Promise<Certificate | null> {
  const code = await getSetting(ctx, itemKey(orderItemId));
  if (!code) return null;
  return parseCertificate(await getSetting(ctx, certKey(code)));
}

export async function certificateByCode(
  ctx: TenantContext,
  code: string,
): Promise<Certificate | null> {
  return parseCertificate(await getSetting(ctx, certKey(code)));
}

/**
 * Выдать сертификат, если курс пройден. `created` — выдан именно сейчас
 * (ученику стоит написать); повторный вызов отдаёт тот же сертификат с false.
 */
export async function issueCertificate(
  ctx: TenantContext,
  p: CoursePurchase,
  now = new Date(),
): Promise<{ certificate: Certificate; created: boolean } | null> {
  const existing = await certificateOf(ctx, p.orderItemId);
  if (existing) return { certificate: existing, created: false };
  if (!(await courseFinished(ctx, p, now))) return null;

  // Бронь кода: победитель один. Проигравший отдаёт то, что записал победитель.
  const mine = newCertificateCode();
  let code = mine;
  const claim = await updateSettingAtomic(ctx, itemKey(p.orderItemId), (raw) => {
    if (raw) {
      code = raw;
      return null;
    }
    return mine;
  });
  if (claim === "failed") return null;

  // Запись сертификата. Победитель пишет её сразу; если на прошлом разе
  // оборвались между бронью и записью, запись допишет следующий вызов.
  // Номер берётся только под запись; потерянный в гонке номер — пропуск.
  const have = parseCertificate(await getSetting(ctx, certKey(code)));
  if (have) return { certificate: have, created: false };
  let counter = 0;
  const n = await updateSettingAtomic(ctx, NO_KEY, (raw) => {
    counter = (Number.parseInt(raw ?? "0", 10) || 0) + 1;
    return String(counter);
  });
  if (n !== "written") return null;
  const made: Certificate = {
    code,
    no: counter,
    orderItemId: p.orderItemId,
    student: await studentName(ctx, p.orderId),
    course: p.name,
    issuedAt: now.toISOString(),
  };
  const wrote = await updateSettingAtomic(ctx, certKey(code), (raw) =>
    raw ? null : JSON.stringify(made),
  );
  if (wrote === "failed") return null;
  if (wrote === "written") return { certificate: made, created: true };
  const winner = parseCertificate(await getSetting(ctx, certKey(code)));
  return winner ? { certificate: winner, created: false } : null;
}
