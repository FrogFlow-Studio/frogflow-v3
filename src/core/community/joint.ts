import { normalizeCode } from "@/core/discounts/pure";

/**
 * Совместные акции магазинов (С5): правила без базы. Платформа деньги не собирает и не делит:
 * у каждого участника свой обычный промокод своего магазина и своя скидка за свой счёт.
 */
export const JOINT = {
  titleMin: 3,
  title: 80,
  conditions: 300,
  percentMin: 1,
  percentMax: 90,
  /** Вместе с автором, предложившим акцию. */
  membersMin: 2,
  membersMax: 3,
  codeMin: 3,
  codeMax: 30,
  /** Дальше года вперёд акцию не планируем. */
  maxDays: 366,
} as const;

export type JointTerms = { code: string; percent: number; conditions: string };
export type TermsError = "code" | "percent";

export function cleanTerms(
  input: unknown,
): { ok: true; value: JointTerms } | { ok: false; error: TermsError } {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const code = normalizeCode(typeof raw.code === "string" ? raw.code : "");
  if (code.length < JOINT.codeMin || code.length > JOINT.codeMax || !/^[A-Z0-9_-]+$/.test(code))
    return { ok: false, error: "code" };
  const percent = Number(raw.percent);
  if (!Number.isInteger(percent) || percent < JOINT.percentMin || percent > JOINT.percentMax)
    return { ok: false, error: "percent" };
  const conditions =
    typeof raw.conditions === "string"
      ? raw.conditions.replace(/\s+/g, " ").trim().slice(0, JOINT.conditions)
      : "";
  return { ok: true, value: { code, percent, conditions } };
}

export function cleanTitle(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, JOINT.title) : "";
  return s.length >= JOINT.titleMin ? s : null;
}

/** Дата окончания: в будущем и не позже чем через год; иначе null. */
export function cleanEndsAt(raw: unknown, now: Date = new Date()): Date | null {
  const d = typeof raw === "string" ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= now.getTime()) return null;
  if (d.getTime() > now.getTime() + JOINT.maxDays * 86_400_000) return null;
  return d;
}

export type JointStatus = "proposed" | "active" | "cancelled";
export type JointEffective = JointStatus | "ended";

/** Идёт ли акция сейчас: активна и срок не вышел. Окончание считаем по времени, в базу его не пишем. */
export function jointEffective(
  p: { status: string; ends_at: string },
  now: Date = new Date(),
): JointEffective {
  const status =
    (["proposed", "active", "cancelled"] as const).find((s) => s === p.status) ?? "cancelled";
  if (status === "active" && new Date(p.ends_at).getTime() <= now.getTime()) return "ended";
  return status;
}

/** Все ли участники согласились и у каждого уже есть своя строка промокода. */
export function allReady(
  members: ReadonlyArray<{ status: string; promo_code_id: string | null }>,
): boolean {
  return (
    members.length >= JOINT.membersMin &&
    members.every((m) => m.status === "accepted" && Boolean(m.promo_code_id))
  );
}
