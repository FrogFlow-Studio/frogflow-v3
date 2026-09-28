import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { setSetting } from "@/core/settings/settings";

/**
 * Один покупатель во всех каналах. Человек, написавший в Instagram, потом в
 * Telegram и купивший на сайте, — это три строки bot_users (ключ канала
 * разный). Склейка без новой таблицы:
 * - автоматически — по телефону (последние 10 цифр: «+7 701…», «8701…» и
 *   номер WhatsApp из ключа `wa_…` совпадают) или почте без учёта регистра;
 * - вручную — продавец связывает два профиля в карточке: строка app_settings
 *   `customer_link:<user_key>` со списком связанных ключей, пишется у обоих.
 * Связь на один шаг: карточка показывает профили, связанные с этим напрямую.
 */
export const LINK_PREFIX = "customer_link:";
const MAX_LINKS = 20;

export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function emailKey(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export type ProfileRow = {
  user_key: string;
  telegram_id: number | string;
  platform: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  contact_phone: string | null;
  email: string | null;
};

/** Признаки личности профиля: телефон (и из ключа WhatsApp) и почта. */
export function identityKeys(
  p: Pick<ProfileRow, "user_key" | "contact_phone" | "email">,
): string[] {
  const out = new Set<string>();
  const phone = phoneKey(p.contact_phone);
  if (phone) out.add(`p:${phone}`);
  if (p.user_key.startsWith("wa_")) {
    const wa = phoneKey(p.user_key.slice(3));
    if (wa) out.add(`p:${wa}`);
  }
  const email = emailKey(p.email);
  if (email) out.add(`e:${email}`);
  return [...out];
}

export type LinkReason = "phone" | "email" | "manual";

export type LinkedProfile = {
  userKey: string;
  telegramId: number;
  platform: string;
  name: string;
  username: string | null;
  reasons: LinkReason[];
};

/** Кто из `others` — тот же человек, что `self`: по признакам или ручной связи. */
export function matchProfiles(
  self: ProfileRow,
  others: ProfileRow[],
  manual: ReadonlySet<string>,
): LinkedProfile[] {
  const mine = new Set(identityKeys(self));
  const out: LinkedProfile[] = [];
  for (const o of others) {
    if (o.user_key === self.user_key) continue;
    const reasons = new Set<LinkReason>();
    for (const k of identityKeys(o))
      if (mine.has(k)) reasons.add(k.startsWith("p:") ? "phone" : "email");
    if (manual.has(o.user_key)) reasons.add("manual");
    if (reasons.size === 0) continue;
    out.push({
      userKey: o.user_key,
      telegramId: Number(o.telegram_id),
      platform: o.platform ?? "telegram",
      name: [o.first_name, o.last_name].filter(Boolean).join(" "),
      username: o.username,
      reasons: [...reasons],
    });
  }
  return out;
}

export function parseLinks(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length <= 200))]
      : [];
  } catch {
    return [];
  }
}

async function readLinks(ctx: TenantContext, userKey: string): Promise<string[]> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", `${LINK_PREFIX}${userKey}`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseLinks(data?.value);
}

const PROFILE_COLS =
  "user_key, telegram_id, platform, username, first_name, last_name, contact_phone, email";

/** Профили этого покупателя в других каналах магазина. */
export async function linkedProfiles(
  ctx: TenantContext,
  self: ProfileRow,
): Promise<LinkedProfile[]> {
  const manual = new Set(await readLinks(ctx, self.user_key));
  const keys = identityKeys(self);
  if (keys.length === 0 && manual.size === 0) return [];
  // Телефоны записаны по-разному («+7 701…», «8 701…»), SQL их не сравнит:
  // покупатели магазина читаются постранично, сравнение — здесь.
  const candidates = await pageAll<ProfileRow>(
    (from, to) => ctx.db.from("bot_users").select(PROFILE_COLS).order("user_key").range(from, to),
    "Профили покупателя в других каналах не прочитались",
  );
  return matchProfiles(self, candidates, manual);
}

async function writeLinks(ctx: TenantContext, userKey: string, links: string[]): Promise<void> {
  await setSetting(ctx, `${LINK_PREFIX}${userKey}`, JSON.stringify(links.slice(0, MAX_LINKS)));
}

async function exists(ctx: TenantContext, userKey: string): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("bot_users")
    .select("user_key")
    .eq("user_key", userKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** Связать два профиля вручную (у обоих); false — одного из них нет или это один профиль. */
export async function linkProfiles(ctx: TenantContext, a: string, b: string): Promise<boolean> {
  if (a === b || !(await exists(ctx, a)) || !(await exists(ctx, b))) return false;
  const [la, lb] = await Promise.all([readLinks(ctx, a), readLinks(ctx, b)]);
  await Promise.all([
    la.includes(b) ? null : writeLinks(ctx, a, [...la, b]),
    lb.includes(a) ? null : writeLinks(ctx, b, [...lb, a]),
  ]);
  return true;
}

/** Снять ручную связь у обоих; связь по телефону или почте так не снимается. */
export async function unlinkProfiles(ctx: TenantContext, a: string, b: string): Promise<void> {
  const [la, lb] = await Promise.all([readLinks(ctx, a), readLinks(ctx, b)]);
  await Promise.all([
    la.includes(b)
      ? writeLinks(
          ctx,
          a,
          la.filter((k) => k !== b),
        )
      : null,
    lb.includes(a)
      ? writeLinks(
          ctx,
          b,
          lb.filter((k) => k !== a),
        )
      : null,
  ]);
}
