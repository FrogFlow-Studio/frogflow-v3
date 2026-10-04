import { randomBytes } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import {
  getSettingStrict,
  getSettingsStrict,
  updateSettingStamped,
} from "@/core/settings/settings";

/**
 * Розыгрыш (модуль giveaways): продавец заводит конкурс — приз, канал участия,
 * условия, срок, число победителей, исключения. Хранение — app_settings:
 * `giveaway:<id>` (сам розыгрыш) и `giveaway:index` (список id). Запись
 * условная по метке updated_at (updateSettingStamped), поэтому два окна
 * админки не затирают друг друга. Участники, выбор и итоги — отдельными
 * пунктами партии, здесь только карточка розыгрыша.
 */
export const GIVEAWAY_PREFIX = "giveaway:";
export const GIVEAWAY_INDEX_KEY = "giveaway:index";
/** Потолок на магазин: список читается целиком, без тихой обрезки — сверх него завести нельзя. */
export const GIVEAWAY_MAX = 200;
export const GIVEAWAY_MAX_WINNERS = 50;
export const GIVEAWAY_MAX_DAYS = 365;

export const GIVEAWAY_CHANNELS = ["telegram", "instagram", "both"] as const;
export type GiveawayChannel = (typeof GIVEAWAY_CHANNELS)[number];
/** open — идёт приём; closed — приём закрыт; drawn — победители выбраны. */
export const GIVEAWAY_STATUSES = ["open", "closed", "drawn"] as const;
export type GiveawayStatus = (typeof GIVEAWAY_STATUSES)[number];

export type Giveaway = {
  id: string;
  /** Версия записи: растёт при каждой правке, окно со старой версией получает отказ. */
  rev: number;
  title: string;
  prize: string;
  channel: GiveawayChannel;
  /** Условия участия — текст для участников. */
  conditions: string;
  /** Срок приёма, ISO. */
  endsAt: string;
  winners: number;
  /** Не выбирать победителем заблокированных продавцом. */
  excludeBlocked: boolean;
  /** Не выбирать победителем сотрудников магазина. */
  excludeStaff: boolean;
  status: GiveawayStatus;
  createdAt: string;
  updatedAt: string;
};

/** То, что продавец вводит в форме. */
export type GiveawayInput = {
  title: string;
  prize: string;
  channel: GiveawayChannel;
  conditions: string;
  endsAt: string;
  winners: number;
  excludeBlocked: boolean;
  excludeStaff: boolean;
};

export const giveawayKey = (id: string) => `${GIVEAWAY_PREFIX}${id}`;

/** Короткий id для ссылок и ключей: 8 символов a–z0–9. */
export function newGiveawayId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function isGiveawayId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9]{8}$/.test(id);
}

export function parseGiveaway(raw: string | null | undefined): Giveaway | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Giveaway>;
    if (!isGiveawayId(p.id) || typeof p.endsAt !== "string" || Number.isNaN(Date.parse(p.endsAt)))
      return null;
    const winners = Math.round(Number(p.winners));
    return {
      id: p.id,
      rev: Number.isInteger(p.rev) && (p.rev as number) >= 1 ? (p.rev as number) : 1,
      title: typeof p.title === "string" ? p.title : "",
      prize: typeof p.prize === "string" ? p.prize : "",
      channel: GIVEAWAY_CHANNELS.includes(p.channel as GiveawayChannel)
        ? (p.channel as GiveawayChannel)
        : "telegram",
      conditions: typeof p.conditions === "string" ? p.conditions : "",
      endsAt: new Date(p.endsAt).toISOString(),
      winners: winners >= 1 && winners <= GIVEAWAY_MAX_WINNERS ? winners : 1,
      excludeBlocked: p.excludeBlocked !== false,
      excludeStaff: p.excludeStaff !== false,
      status: GIVEAWAY_STATUSES.includes(p.status as GiveawayStatus)
        ? (p.status as GiveawayStatus)
        : "open",
      createdAt: typeof p.createdAt === "string" ? p.createdAt : p.endsAt,
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : p.endsAt,
    };
  } catch {
    return null;
  }
}

/** Ключи ошибок проверки формы — для подсветки поля в панели. */
export type GiveawayField = "title" | "prize" | "channel" | "conditions" | "endsAt" | "winners";

/**
 * Проверка формы. Бросает UserError на языке продавца; тексты — в
 * словаре админки (giveaways.ts), здесь русский шаблон тот же.
 */
export function validateGiveawayInput(input: GiveawayInput, now: Date): GiveawayInput {
  const title = input.title.trim();
  const prize = input.prize.trim();
  const conditions = input.conditions.trim();
  if (!title) throw new UserError("err.giveaway.titleRequired", "Укажите название розыгрыша.");
  if (title.length > 80)
    throw new UserError("err.giveaway.titleLong", "Название — не длиннее 80 символов.");
  if (!prize) throw new UserError("err.giveaway.prizeRequired", "Укажите приз.");
  if (prize.length > 200)
    throw new UserError("err.giveaway.prizeLong", "Приз — не длиннее 200 символов.");
  if (conditions.length > 1000)
    throw new UserError("err.giveaway.conditionsLong", "Условия — не длиннее 1000 символов.");
  if (!GIVEAWAY_CHANNELS.includes(input.channel))
    throw new UserError("err.giveaway.badChannel", "Выберите, где проходит розыгрыш.");
  const ends = Date.parse(input.endsAt);
  if (Number.isNaN(ends))
    throw new UserError("err.giveaway.badDate", "Укажите срок приёма участников.");
  if (ends <= now.getTime())
    throw new UserError("err.giveaway.datePast", "Срок приёма должен быть в будущем.");
  if (ends > now.getTime() + GIVEAWAY_MAX_DAYS * 86_400_000)
    throw new UserError("err.giveaway.dateFar", "Срок приёма — не дальше года.");
  if (!Number.isInteger(input.winners) || input.winners < 1 || input.winners > GIVEAWAY_MAX_WINNERS)
    throw new UserError("err.giveaway.badWinners", "Число победителей — целое от 1 до {max}.", {
      max: GIVEAWAY_MAX_WINNERS,
    });
  return {
    title,
    prize,
    conditions,
    channel: input.channel,
    endsAt: new Date(ends).toISOString(),
    winners: input.winners,
    excludeBlocked: input.excludeBlocked,
    excludeStaff: input.excludeStaff,
  };
}

const failedSave = () =>
  new UserError(
    "err.settings.saveFailed",
    "Настройка не сохранилась. Попробуйте ещё раз; если повторится — напишите в поддержку.",
  );

async function readIndex(ctx: TenantContext): Promise<string[]> {
  const raw = await getSettingStrict(ctx, GIVEAWAY_INDEX_KEY);
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? p.filter(isGiveawayId) : [];
  } catch {
    return [];
  }
}

/** Один розыгрыш; null — нет такого. Сбой чтения — serverFailure, не «нет». */
export async function getGiveaway(ctx: TenantContext, id: string): Promise<Giveaway | null> {
  if (!isGiveawayId(id)) return null;
  return parseGiveaway(await getSettingStrict(ctx, giveawayKey(id)));
}

/** Все розыгрыши магазина, новые сверху; сортировка кончается id. */
export async function listGiveaways(ctx: TenantContext): Promise<Giveaway[]> {
  const ids = await readIndex(ctx);
  const out: Giveaway[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const keys = ids.slice(i, i + 200).map(giveawayKey);
    const got = await getSettingsStrict(ctx, keys);
    for (const k of keys) {
      const g = parseGiveaway(got[k]);
      if (g) out.push(g);
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** Завести розыгрыш: сначала запись самого розыгрыша, потом id в списке. */
export async function createGiveaway(
  ctx: TenantContext,
  input: GiveawayInput,
  now = new Date(),
): Promise<Giveaway> {
  const valid = validateGiveawayInput(input, now);
  if ((await readIndex(ctx)).length >= GIVEAWAY_MAX)
    throw new UserError("err.giveaway.limit", "Розыгрышей уже {max}: больше завести нельзя.", {
      max: GIVEAWAY_MAX,
    });
  const stamp = now.toISOString();
  const g: Giveaway = {
    id: newGiveawayId(),
    rev: 1,
    ...valid,
    status: "open",
    createdAt: stamp,
    updatedAt: stamp,
  };
  // Только если ключа ещё нет: случайный id не должен затереть существующий.
  const row = await updateSettingStamped(ctx, giveawayKey(g.id), (raw) =>
    raw == null ? JSON.stringify(g) : null,
  );
  if (row !== "written") throw failedSave();
  const idx = await updateSettingStamped(ctx, GIVEAWAY_INDEX_KEY, (raw) => {
    const ids = raw ? (JSON.parse(raw) as string[]).filter(isGiveawayId) : [];
    return ids.includes(g.id) ? null : JSON.stringify([...ids, g.id]);
  });
  if (idx !== "written") throw failedSave();
  return g;
}

/**
 * Правка условий открытого розыгрыша. `rev` — версия, которую видел
 * продавец: запись прошла, только если в базе всё ещё она.
 */
export async function updateGiveaway(
  ctx: TenantContext,
  id: string,
  rev: number,
  input: GiveawayInput,
  now = new Date(),
): Promise<Giveaway> {
  const valid = validateGiveawayInput(input, now);
  const box: Box = { verdict: "ok", g: null };
  const r = await updateSettingStamped(ctx, giveawayKey(id), (raw) => {
    const cur = parseGiveaway(raw);
    if (!cur) {
      box.verdict = "missing";
      return null;
    }
    if (cur.rev !== rev) {
      box.verdict = "stale";
      return null;
    }
    if (cur.status !== "open") {
      box.verdict = "closed";
      return null;
    }
    box.g = { ...cur, ...valid, rev: cur.rev + 1, updatedAt: now.toISOString() };
    return JSON.stringify(box.g);
  });
  if (r === "failed") throw failedSave();
  throwVerdict(box.verdict);
  if (!box.g) throw failedSave();
  return box.g;
}

/** Закрыть приём досрочно. Повторное закрытие — не ошибка и ничего не меняет. */
export async function closeGiveaway(
  ctx: TenantContext,
  id: string,
  now = new Date(),
): Promise<Giveaway> {
  const box: Box = { verdict: "ok", g: null };
  const r = await updateSettingStamped(ctx, giveawayKey(id), (raw) => {
    const cur = parseGiveaway(raw);
    if (!cur) {
      box.verdict = "missing";
      return null;
    }
    box.g = cur;
    if (cur.status !== "open") return null;
    box.g = { ...cur, status: "closed", rev: cur.rev + 1, updatedAt: now.toISOString() };
    return JSON.stringify(box.g);
  });
  if (r === "failed") throw failedSave();
  throwVerdict(box.verdict);
  if (!box.g) throw failedSave();
  return box.g;
}

type Verdict = "ok" | "missing" | "stale" | "closed";
type Box = { verdict: Verdict; g: Giveaway | null };

function throwVerdict(v: Verdict): void {
  if (v === "missing") throw new UserError("err.giveaway.notFound", "Розыгрыш не найден.");
  if (v === "stale")
    throw new UserError(
      "err.giveaway.stale",
      "Розыгрыш изменён в другом окне. Обновите страницу и повторите.",
    );
  if (v === "closed")
    throw new UserError("err.giveaway.notOpen", "Приём закрыт — условия уже не меняются.");
}
