import type { TenantContext } from "@/core/tenant/resolve.server";
import { trySetSetting } from "@/core/settings/settings";
import { HW_FEEDBACK_MAX } from "./homework";
import { readSetting } from "./db.server";
import { sha256Hex } from "@/lib/hash";

/**
 * Проверка ДЗ из Telegram: в уведомлении преподавателю — короткая метка
 * работы `[#hw:<ref>]`. Кнопки и ответ свайпом несут только метку (в
 * callback_data не помещаются два uuid), по ней находится сдача.
 *
 * Метка — хэш позиции и урока: одинаковая при каждой сдаче той же работы,
 * поэтому запись соответствия пишется без условия — любой писатель пишет
 * одно и то же значение.
 */
export const HW_REF_PREFIX = "course_hwref_";
export const HW_DRAFT_PREFIX = "course_hwdraft_";
/** Комментарий из ответа свайпом живёт сутки: потом кнопки просят написать заново. */
export const HW_DRAFT_TTL_MS = 24 * 3600_000;

const REF_RE = /\[#hw:([0-9a-f]{12})\]/;

export const hwRef = (orderItemId: string, lessonId: string) =>
  sha256Hex(`${orderItemId}:${lessonId}`, 12);

export const hwRefMark = (ref: string) => `[#hw:${ref}]`;

/** Метка из текста уведомления, на которое ответили. */
export function hwRefOf(text: string | null | undefined): string | null {
  return text?.match(REF_RE)?.[1] ?? null;
}

export type HwTarget = { orderItemId: string; lessonId: string };

export async function saveHwRef(ctx: TenantContext, t: HwTarget): Promise<string> {
  const ref = hwRef(t.orderItemId, t.lessonId);
  await trySetSetting(ctx, `${HW_REF_PREFIX}${ref}`, JSON.stringify(t));
  return ref;
}

export async function resolveHwRef(ctx: TenantContext, ref: string): Promise<HwTarget | null> {
  if (!/^[0-9a-f]{12}$/.test(ref)) return null;
  try {
    const o = JSON.parse((await readSetting(ctx, `${HW_REF_PREFIX}${ref}`)) ?? "null") as HwTarget;
    // Метка сверяется с содержимым: чужая или битая запись не подменит работу.
    return o && hwRef(o.orderItemId, o.lessonId) === ref ? o : null;
  } catch {
    return null;
  }
}

/**
 * Комментарий преподавателя из ответа свайпом ждёт нажатия «Принять» или
 * «На доработку». Ключ — метка и id сообщения с ответом: у каждого
 * комментария своя запись, два преподавателя не затирают друг друга.
 */
const draftKey = (ref: string, messageId: number) => `${HW_DRAFT_PREFIX}${ref}_${messageId}`;

export async function saveHwDraft(
  ctx: TenantContext,
  ref: string,
  messageId: number,
  text: string,
  now = new Date(),
): Promise<boolean> {
  return trySetSetting(
    ctx,
    draftKey(ref, messageId),
    JSON.stringify({ text: text.trim().slice(0, HW_FEEDBACK_MAX), at: now.toISOString() }),
  );
}

/** Комментарий по кнопке; просроченный или чужой — null. Запись не удаляется: повтор кнопки увидит «уже проверено». */
export async function readHwDraft(
  ctx: TenantContext,
  ref: string,
  messageId: number,
  now = new Date(),
): Promise<string | null> {
  try {
    const o = JSON.parse((await readSetting(ctx, draftKey(ref, messageId))) ?? "null") as {
      text?: string;
      at?: string;
    } | null;
    if (!o?.text || !o.at || now.getTime() - Date.parse(o.at) > HW_DRAFT_TTL_MS) return null;
    return o.text;
  } catch {
    return null;
  }
}

/** Использованный комментарий — убрать (сбой уборки не мешает проверке). */
export async function dropHwDraft(ctx: TenantContext, ref: string, messageId: number) {
  const { error } = await ctx.db.from("app_settings").delete().eq("key", draftKey(ref, messageId));
  if (error) console.warn(`[courses] черновик отзыва не убран: ${error.message}`);
}
