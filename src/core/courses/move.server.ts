import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateSettingAtomic } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { courseKey, parseCourse } from "./course";
import {
  CHAT_SLOT,
  parseInvite,
  purchaseChat,
  revokeItemChannelDetailed,
  type ChannelAccess,
} from "./channel.server";
import { parseRun, purchaseTimeline, runKey, startRun, type CoursePurchase } from "./run.server";
import { readSetting } from "./db.server";

/**
 * Перевод ученика в другой поток (болел, не успел). Поток покупки хранится в
 * записи прохождения (`course_run_<позиция>.cohortId`) — её и меняем, условно:
 * только если за время работы продавца поток не поменяли. Расписание, срок
 * доступа и чат считаются от нового потока. Из чата старого потока ученик
 * исключается, а ссылка в новый чат выдаётся заново при следующем обращении
 * в «Мои курсы». Отметки пройденных уроков и заданий не трогаем.
 */
export type MoveResult =
  | { ok: true; from: string; to: string; kicked: number; failed: number }
  | { ok: false; reason: "notFound" | "noCohort" | "same" | "changed" };

export async function moveStudentCohort(
  ctx: TenantContext,
  orderItemId: string,
  toCohortId: string,
  access: ChannelAccess | null,
  actor = "admin",
  now = new Date(),
): Promise<MoveResult> {
  const { data: item, error } = await ctx.db
    .from("order_items")
    .select("id, order_id, product_id, product_variant_id, name_snapshot")
    .eq("id", orderItemId)
    .maybeSingle();
  if (error) throw serverFailure(`Покупка не прочитана: ${error.message}`);
  if (!item?.product_id) return { ok: false, reason: "notFound" };
  const { data: order, error: orderError } = await ctx.db
    .from("orders")
    .select("id, status, platform, telegram_id, created_at")
    .eq("id", item.order_id)
    .maybeSingle();
  if (orderError) throw serverFailure(`Заказ не прочитан: ${orderError.message}`);
  if (order?.status !== "delivered") return { ok: false, reason: "notFound" };
  const course = parseCourse(await readSetting(ctx, courseKey(item.product_id)));
  const target = (course.cohorts ?? []).find((c) => c.id === toCohortId);
  if (!target) return { ok: false, reason: "noCohort" };

  const base: CoursePurchase = {
    orderItemId: item.id,
    orderId: item.order_id,
    boughtAt: order.created_at,
    variantId: item.product_variant_id ?? null,
    telegramId: order.telegram_id ?? null,
    productId: item.product_id,
    name: item.name_snapshot,
    course,
    run: parseRun(await readSetting(ctx, runKey(item.id))),
  };
  // Курс ещё не начат — запись прохождения создаётся сейчас (как при выдаче).
  const run = await startRun(ctx, base, now);
  const before = purchaseTimeline(ctx, { ...base, run }, now);
  const fromId = before.cohort?.id ?? "";
  if (fromId === toCohortId) return { ok: false, reason: "same" };
  const oldChat = purchaseChat(ctx, { ...base, run }, now);

  let changed = false;
  const written = await updateSettingAtomic(ctx, runKey(item.id), (raw) => {
    const cur = parseRun(raw) ?? run;
    const curId = purchaseTimeline(ctx, { ...base, run: cur }, now).cohort?.id ?? "";
    if (curId !== fromId) {
      changed = true;
      return null;
    }
    // Напоминания «до старта» — заново для нового потока; о сколько уроков
    // открыто на новом календаре, бот уже не пишет.
    const { pre: _pre, ...rest } = cur;
    const next = { ...rest, cohortId: toCohortId };
    const open = purchaseTimeline(ctx, { ...base, run: next }, now).access.filter(
      (a) => a.open,
    ).length;
    return JSON.stringify({ ...next, notified: open });
  });
  if (changed) return { ok: false, reason: "changed" };
  if (written !== "written") throw serverFailure("Поток ученика не изменён: сбой записи");

  let kicked = 0;
  let failed = 0;
  const newChat = purchaseChat(ctx, { ...base, run: { ...run, cohortId: toCohortId } }, now);
  let resetFailed = false;
  if (oldChat && oldChat !== newChat) {
    const old = parseInvite(await readSetting(ctx, CHAT_SLOT.key(item.id)));
    if (access) {
      // «none» — в чат не вступал, исключать некого: это не сбой.
      const r = await revokeItemChannelDetailed(
        ctx,
        item.id,
        oldChat,
        order,
        access,
        now,
        CHAT_SLOT,
      );
      if (r === "kicked") kicked++;
      else if (r === "failed") failed++;
    } else if (old.member || old.link) {
      // Бота нет: ссылку отозвать и ученика исключить нечем — продавцу вручную.
      failed++;
    }
    // Запись чата начинается заново: новая ссылка — в чат нового потока, а метка
    // «снято» старого чата её не закрывает. Не исключённого остаётся помнить (member),
    // чтобы сверка «в канале без доступа» показала его в старом чате; ссылку старого
    // чата Telegram гасит сам (сутки), без бота — она остаётся в силе до этого.
    const keepMember = failed > 0 && old.member ? { member: old.member } : {};
    resetFailed =
      (await updateSettingAtomic(ctx, CHAT_SLOT.key(item.id), () => JSON.stringify(keepMember))) !==
      "written";
  }
  const { recordOrderEvent } = await import("@/core/orders/events");
  await recordOrderEvent(
    ctx,
    item.order_id,
    "cohort_moved",
    {
      from: before.cohort?.title ?? "",
      to: target.title,
      ...(oldChat && oldChat !== newChat ? { kicked, failed } : {}),
      ...(resetFailed ? { stuck: true } : {}),
    },
    actor,
  );
  // Метка «снято» старого чата осталась — ссылка в новый чат не выдастся: сказать, а не молчать.
  if (resetFailed)
    throw serverFailure("Поток изменён, но ссылку в новый чат не удалось подготовить");
  return { ok: true, from: fromId, to: toCohortId, kicked, failed };
}
