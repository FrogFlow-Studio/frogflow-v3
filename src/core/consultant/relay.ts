import { randomBytes } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";

/**
 * Ответ менеджера из Telegram покупателю в Direct (v1 f9cc53d, d1bad1f).
 * Менеджер отвечал свайпом на уведомление «Клиент ждёт менеджера» — и
 * получал приветствие консультанта: его принимали за покупателя. Теперь в
 * уведомлении — метка `[#k:<код>]`; код → покупатель лежит в app_settings
 * `handoff_refs` (последние 120, неделю). Ответ на такое уведомление уходит
 * покупателю, пересланный текст запоминается, чтобы проверка «менеджер в
 * чате» не приняла его за чужого менеджера.
 */
export const REFS_KEY = "handoff_refs";
export const MAX_REFS = 120;
export const REF_TTL_MS = 7 * 24 * 3600_000;
const REF_RE = /\[#k:([a-z0-9]{6,12})\]/;

type Ref = { t: string; k: string; at: number };

function parseRefs(raw: string | null): Ref[] {
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(v)
      ? v.filter(
          (r): r is Ref =>
            Boolean(r) &&
            typeof (r as Ref).t === "string" &&
            typeof (r as Ref).k === "string" &&
            typeof (r as Ref).at === "number",
        )
      : [];
  } catch {
    return [];
  }
}

/** Новый код для уведомления о передаче; старше недели и сверх 120 — забываются. */
export async function issueHandoffRef(
  ctx: TenantContext,
  userKey: string,
  now = Date.now(),
): Promise<string> {
  const t = randomBytes(6)
    .toString("base64url")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "x");
  const refs = parseRefs(await getSetting(ctx, REFS_KEY)).filter((r) => now - r.at < REF_TTL_MS);
  const next = [...refs, { t, k: userKey, at: now }].slice(-MAX_REFS);
  await setSetting(ctx, REFS_KEY, JSON.stringify(next));
  return t;
}

/** Строка в конец уведомления: как ответить и сама метка. */
export function handoffRefLine(
  token: string,
  hint = "↩️ Ответьте на это сообщение свайпом — ответ уйдёт покупателю.",
): string {
  return `${hint} [#k:${token}]`;
}

export function handoffRefOf(text: string | null | undefined): string | null {
  return REF_RE.exec(text ?? "")?.[1] ?? null;
}

/** Покупатель по коду из уведомления; просроченный или чужой код — null. */
export async function resolveHandoffRef(
  ctx: TenantContext,
  token: string,
  now = Date.now(),
): Promise<string | null> {
  const r = parseRefs(await getSetting(ctx, REFS_KEY)).find((x) => x.t === token);
  return r && now - r.at < REF_TTL_MS ? r.k : null;
}
