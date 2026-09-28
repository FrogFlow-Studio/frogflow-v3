import { randomBytes } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { getSetting, updateSettingStamped } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import {
  HW_FILE_MAX_BYTES,
  HW_KEY_PREFIX,
  HW_MIME_EXT,
  hwFolder,
  hwKey,
  mergesInto,
  parseHomework,
  reviewProblem,
  submitProblem,
  withReview,
  withSubmission,
  type Homework,
  type HomeworkFile,
  type ReviewInput,
  type ReviewProblem,
  type SubmitProblem,
} from "./homework";
import {
  coursePurchase,
  markLesson,
  purchaseTimeline,
  startRun,
  type CoursePurchase,
} from "./run.server";

/**
 * Домашние задания: сдача учеником (страница курса, позже — бот), очередь и
 * проверка преподавателем (админка). Модель и правила — core/courses/homework.
 */

/** Тип файла по первым байтам: заголовку браузера не верим. */
export function sniffHomeworkMime(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  // ISO BMFF: «ftyp» с 4-го байта — mp4, mov, heic.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
    if (/^(heic|heix|mif1|msf1)$/.test(brand)) return "image/heic";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  return null;
}

export type UploadResult =
  | { ok: true; file: HomeworkFile }
  | { ok: false; reason: "empty" | "tooLarge" | "badType" | "failed" };

/** Файл ответа ученика — в его папку этой покупки. */
export async function uploadHomeworkFile(
  ctx: TenantContext,
  orderItemId: string,
  bytes: Uint8Array,
  name: string | null,
): Promise<UploadResult> {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > HW_FILE_MAX_BYTES) return { ok: false, reason: "tooLarge" };
  const mime = sniffHomeworkMime(bytes);
  if (!mime) return { ok: false, reason: "badType" };
  const path = `${hwFolder(ctx.tenant.id, orderItemId)}${randomBytes(12).toString("hex")}.${HW_MIME_EXT[mime]}`;
  const { error } = await serviceDb()
    .storage.from("product-files")
    .upload(path, new Blob([bytes as BlobPart], { type: mime }), {
      contentType: mime,
      upsert: false,
    });
  if (error) {
    console.error(`[homework:${ctx.tenant.id}] файл не сохранён: ${error.message}`);
    return { ok: false, reason: "failed" };
  }
  return { ok: true, file: { path, name: name?.slice(0, 200) || null, mime } };
}

/** Сдачи одной покупки по урокам. */
export async function purchaseHomework(
  ctx: TenantContext,
  orderItemId: string,
): Promise<Map<string, Homework>> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .like("key", `${HW_KEY_PREFIX}${orderItemId}_%`);
  if (error) throw serverFailure(`Домашние задания не прочитаны: ${error.message}`);
  const out = new Map<string, Homework>();
  for (const r of data ?? []) {
    const hw = parseHomework(r.value);
    if (hw && hw.orderItemId === orderItemId) out.set(hw.lessonId, hw);
  }
  return out;
}

/** Кто учится: имя из заказа, иначе @логин, иначе ключ покупателя. */
async function studentName(ctx: TenantContext, orderId: number): Promise<string> {
  const { data } = await ctx.db
    .from("orders")
    .select("display_name, username, user_key")
    .eq("id", orderId)
    .maybeSingle();
  return (
    data?.display_name?.trim() ||
    (data?.username ? `@${data.username}` : "") ||
    data?.user_key ||
    `#${orderId}`
  );
}

export type SubmitResult =
  /** merged — часть уже присланного альбома: преподавателю второй раз не пишем. */
  | { ok: true; homework: Homework; merged: boolean }
  | { ok: false; reason: SubmitProblem | "noHomework" | "notInTariff" | "closed" | "conflict" };

/** Сдать ответ на задание урока: только открытый урок с заданием этой покупки. */
export async function submitHomework(
  ctx: TenantContext,
  p: CoursePurchase,
  lessonId: string,
  answer: { text: string; files: HomeworkFile[]; group?: string },
  now = new Date(),
): Promise<SubmitResult> {
  const run = await startRun(ctx, p, now);
  const tl = purchaseTimeline(ctx, { ...p, run }, now);
  const access = tl.access.find((a) => a.lesson.id === lessonId);
  if (!access?.lesson.homework) return { ok: false, reason: "noHomework" };
  // Тариф без проверки ДЗ: задание видно, но сдавать некому.
  if (!tl.tariff.homework) return { ok: false, reason: "notInTariff" };
  if (!access.open) return { ok: false, reason: "closed" };
  const student = await studentName(ctx, p.orderId);
  let problem: SubmitProblem | null = null;
  let saved: Homework | null = null;
  let merged = false;
  const r = await updateSettingStamped(ctx, hwKey(p.orderItemId, lessonId), (raw) => {
    const current = parseHomework(raw);
    problem = submitProblem(ctx.tenant.id, current, {
      orderItemId: p.orderItemId,
      text: answer.text,
      files: answer.files,
      group: answer.group,
    });
    if (problem) return null;
    merged = mergesInto(current, answer);
    saved = withSubmission(
      current,
      {
        orderItemId: p.orderItemId,
        lessonId,
        productId: p.productId,
        course: p.name,
        lessonNo: access.no,
        lessonTitle: access.lesson.title,
        student,
        ...answer,
      },
      now,
    );
    return JSON.stringify(saved);
  });
  if (problem) return { ok: false, reason: problem };
  if (r !== "written" || !saved) return { ok: false, reason: "conflict" };
  return { ok: true, homework: saved, merged };
}

/** Очередь преподавателя: на проверке — первыми, по давности; дальше — проверенные. */
export async function listHomework(ctx: TenantContext): Promise<Homework[]> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${HW_KEY_PREFIX}%`)
        .order("key")
        .range(from, to),
    "домашние задания",
  );
  const list = rows.flatMap((r) => {
    const hw = parseHomework(r.value);
    return hw ? [hw] : [];
  });
  return list.sort((a, b) => {
    const wait = Number(b.status === "submitted") - Number(a.status === "submitted");
    if (wait) return wait;
    return a.status === "submitted"
      ? a.updatedAt.localeCompare(b.updatedAt)
      : b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function getHomework(
  ctx: TenantContext,
  orderItemId: string,
  lessonId: string,
): Promise<Homework | null> {
  return parseHomework(await getSetting(ctx, hwKey(orderItemId, lessonId)));
}

export type ReviewResult =
  | {
      ok: true;
      homework: Homework;
      /** Куда сообщить ученику: заказ из Telegram — его id, иначе null. */
      notify: { telegramId: number | null; platform: string | null; orderId: number } | null;
    }
  | { ok: false; reason: ReviewProblem | "conflict" };

/** Проверка преподавателя: принять (урок пройден) или вернуть на доработку. */
export async function reviewHomework(
  ctx: TenantContext,
  orderItemId: string,
  lessonId: string,
  review: ReviewInput,
  now = new Date(),
): Promise<ReviewResult> {
  let problem: ReviewProblem | null = null;
  let saved: Homework | null = null;
  const r = await updateSettingStamped(ctx, hwKey(orderItemId, lessonId), (raw) => {
    const current = parseHomework(raw);
    problem = reviewProblem(current, review);
    if (problem || !current) return null;
    saved = withReview(current, review, now);
    return JSON.stringify(saved);
  });
  if (problem) return { ok: false, reason: problem };
  if (r !== "written" || !saved) return { ok: false, reason: "conflict" };
  const hw = saved as Homework;
  const purchase = await coursePurchase(ctx, orderItemId);
  // Принятое задание — урок пройден (ученик видит отметку на странице курса).
  if (purchase && review.status === "accepted")
    await markLesson(ctx, purchase, lessonId, true, now);
  let notify: { telegramId: number | null; platform: string | null; orderId: number } | null = null;
  if (purchase) {
    const { data } = await ctx.db
      .from("orders")
      .select("telegram_id, platform")
      .eq("id", purchase.orderId)
      .maybeSingle();
    notify = {
      telegramId: data?.platform === "telegram" ? (data.telegram_id ?? null) : null,
      platform: data?.platform ?? null,
      orderId: purchase.orderId,
    };
  }
  return { ok: true, homework: hw, notify };
}

/** Сколько работ ждёт проверки — бейдж в меню админки. */
export function waitingCount(list: readonly Homework[]): number {
  return list.filter((h) => h.status === "submitted").length;
}
