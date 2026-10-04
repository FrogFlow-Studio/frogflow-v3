import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { updateSettingStamped } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { courseKey } from "./course";
import {
  LIVE_TITLE_MAX,
  LIVES_MAX,
  liveProblem,
  parseLives,
  upsertLive,
  type Live,
  type LiveProblem,
} from "./live";

/**
 * Эфиры потока в админке (Ш1): добавить, поправить, удалить. Каждая правка —
 * одна условная запись курса по метке `updated_at` (версия записи), а не по
 * всему jsonb: параллельное сохранение формы курса не теряется, а id эфира
 * задаёт форма — повтор того же запроса (двойной клик) даёт один эфир.
 * Остальные поля записи (уроки, тарифы, другие потоки) не трогаются.
 */
export async function saveLive(
  ctx: TenantContext,
  productId: string,
  cohortId: string,
  input: Live,
): Promise<Live[]> {
  const live: Live = {
    id: input.id,
    title: input.title.trim(),
    at: input.at,
    link: input.link?.trim() || null,
  };
  const bad = liveProblem(live);
  if (bad) throw liveRefusal(bad);
  return editLives(ctx, productId, cohortId, (lives) => upsertLive(lives, live));
}

export async function deleteLive(
  ctx: TenantContext,
  productId: string,
  cohortId: string,
  liveId: string,
): Promise<Live[]> {
  return editLives(ctx, productId, cohortId, (lives) => lives.filter((l) => l.id !== liveId));
}

async function editLives(
  ctx: TenantContext,
  productId: string,
  cohortId: string,
  change: (lives: Live[]) => Live[] | "tooMany",
): Promise<Live[]> {
  let refused: LiveProblem | null = null;
  let result: Live[] = [];
  const r = await updateSettingStamped(ctx, courseKey(productId), (raw) => {
    refused = null;
    let obj: Record<string, unknown>;
    try {
      obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      obj = {};
    }
    const own = Array.isArray(obj.cohorts) ? (obj.cohorts as Array<Record<string, unknown>>) : [];
    const i = own.findIndex((c) => c && c.id === cohortId);
    if (i < 0) {
      refused = "noCohort";
      return null;
    }
    const next = change(parseLives(own[i]!.lives));
    if (next === "tooMany") {
      refused = "tooMany";
      return null;
    }
    result = next;
    const cohorts = own.map((c, j) => (j === i ? { ...c, lives: next } : c));
    return JSON.stringify({ ...obj, cohorts });
  });
  if (refused) throw liveRefusal(refused);
  if (r !== "written") throw serverFailure("Эфиры потока не записаны");
  return result;
}

function liveRefusal(p: LiveProblem): UserError {
  switch (p) {
    case "noTitle":
      return new UserError("err.live.noTitle", "Укажите название эфира (до {max} знаков).", {
        max: LIVE_TITLE_MAX,
      });
    case "badTime":
      return new UserError("err.live.badTime", "Укажите дату и время эфира.");
    case "badLink":
      return new UserError("err.live.badLink", "Ссылка на эфир должна начинаться с https://.");
    case "tooMany":
      return new UserError("err.live.tooMany", "У потока не больше {max} эфиров.", {
        max: LIVES_MAX,
      });
    case "noCohort":
      return new UserError(
        "err.live.noCohort",
        "Сначала сохраните курс с этим потоком, потом добавляйте эфиры.",
      );
  }
}
