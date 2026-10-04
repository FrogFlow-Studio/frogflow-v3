import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { UserError } from "@/core/i18n/user-error";
import { patchTenantSettings, tenantDirectory } from "@/core/tenant/resolve.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { serverFailure } from "@/lib/server-failure";
import { CommunityNotReady, isMissingTable } from "./not-ready";
import { DM_LIMITS, cleanDm, dmBlockedList, dmOff, dmSpam, dmVerdict } from "./dm";
import { communityProfile, shownInCommunity, takesPartInCommunity } from "./profile";

/**
 * Личные сообщения между авторами (С3). Таблица общая для авторов (RLS без политик, см.
 * migrations/19-3), поэтому доступ через serviceDb после проверки согласия обоих (dmVerdict).
 * Таблицы может не быть — тогда CommunityNotReady, функции отвечают «скоро».
 */
type DbErr = { code?: string | undefined; message: string } | null;
function check(what: string, error: DbErr): void {
  if (!error) return;
  if (isMissingTable(error)) throw new CommunityNotReady();
  throw serverFailure(`сообщество, личные сообщения, ${what}: ${error.message}`);
}

function requireMember(ctx: Pick<TenantContext, "tenant">): void {
  if (!takesPartInCommunity(ctx.tenant)) {
    throw new UserError(
      "err.community.notJoined",
      "Сначала включите «Показывать меня в сообществе» в настройках.",
    );
  }
}

const find = async (id: string): Promise<Tenant | undefined> =>
  (await tenantDirectory()).find((t) => t.id === id);

export type AuthorItem = { id: string; name: string; niche: string; city: string; about: string };

/** Авторы, которых видно в сообществе, кроме самого себя. */
export async function listAuthors(ctx: TenantContext): Promise<AuthorItem[]> {
  requireMember(ctx);
  return (await tenantDirectory())
    .filter((t) => t.id !== ctx.tenant.id && shownInCommunity(t))
    .map((t) => {
      const p = communityProfile(t.settings);
      return { id: t.id, name: p.name, niche: p.niche, city: p.city, about: p.about };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export type DmPrefs = { off: boolean; blocked: Array<{ id: string; name: string | null }> };

export async function dmPrefs(ctx: TenantContext): Promise<DmPrefs> {
  requireMember(ctx);
  const dir = await tenantDirectory();
  return {
    off: dmOff(ctx.tenant.settings),
    blocked: dmBlockedList(ctx.tenant.settings).map((id) => {
      const t = dir.find((x) => x.id === id);
      return { id, name: t && shownInCommunity(t) ? communityProfile(t.settings).name : null };
    }),
  };
}

export async function setDmOff(ctx: TenantContext, off: boolean): Promise<void> {
  requireMember(ctx);
  await patchTenantSettings(ctx.tenant.id, { community: { dm_off: off } });
}

/** Запретить автору писать мне (или снять запрет). Список — в bots.settings.community.dm_blocked. */
export async function setDmBlocked(
  ctx: TenantContext,
  botId: string,
  blocked: boolean,
): Promise<void> {
  requireMember(ctx);
  if (botId === ctx.tenant.id) return;
  // Свежий снимок: список мог измениться с прошлого чтения справочника.
  const fresh = (await tenantDirectory(true)).find((t) => t.id === ctx.tenant.id);
  const cur = dmBlockedList((fresh ?? ctx.tenant).settings);
  const next = blocked ? [...new Set([...cur, botId])] : cur.filter((x) => x !== botId);
  if (next.length > DM_LIMITS.blocked)
    throw new UserError("err.community.dmBlockedFull", "Список запретов заполнен.");
  await patchTenantSettings(ctx.tenant.id, { community: { dm_blocked: next } });
}

async function countSent(
  what: string,
  from: string,
  to: string | null,
  sinceMs: number,
): Promise<number> {
  let q = serviceDb()
    .from("community_dm")
    .select("id", { count: "exact", head: true })
    .eq("from_bot_id", from)
    .gte("created_at", new Date(Date.now() - sinceMs).toISOString());
  if (to) q = q.eq("to_bot_id", to);
  const { count, error } = await q;
  check(what, error);
  return count ?? 0;
}

/** Отправить сообщение. Возвращает id сообщения и адресата — уведомление шлёт слой приложения. */
export async function sendDm(
  ctx: TenantContext,
  toBotId: string,
  body: unknown,
): Promise<{ id: string; to: Tenant }> {
  requireMember(ctx);
  const text = cleanDm(body);
  if (!text) throw new UserError("err.community.body", "Напишите текст.");
  const to = await find(toBotId);
  const v = dmVerdict(ctx.tenant, to);
  if (v === "dmOff")
    throw new UserError("err.community.dmOff", "Этот автор не принимает личные сообщения.");
  // Запрет и «нет такого автора» одинаково: адресату не видно, кто кого заблокировал.
  if (v !== "ok" || !to)
    throw new UserError("err.community.dmUnavailable", "Этому автору сейчас нельзя написать.");
  const HOUR = 3_600_000;
  const [lastHour, pair] = await Promise.all([
    countSent("лимит за час", ctx.tenant.id, null, HOUR),
    countSent("лимит автору за час", ctx.tenant.id, to.id, HOUR),
  ]);
  const spam = dmSpam({ lastHour, toThisAuthorLastHour: pair });
  if (spam === "hour")
    throw new UserError(
      "err.community.spamHour",
      "Слишком много сообщений за час. Попробуйте позже.",
    );
  if (spam === "pair")
    throw new UserError(
      "err.community.dmPair",
      "Этому автору вы уже написали несколько раз подряд. Подождите ответа.",
    );
  const { data, error } = await serviceDb()
    .from("community_dm")
    .insert({
      from_bot_id: ctx.tenant.id,
      to_bot_id: to.id,
      body: text,
      read_at: null,
      notified_at: null,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  check("сообщение не сохранено", error);
  return { id: data!.id, to };
}

/**
 * Занять право на уведомление: условное обновление (`notified_at is null`), выигрывает один
 * вызов. Только выигравший шлёт сообщение в Telegram, и повторять отправку после обрыва нельзя
 * (могла дойти) — поэтому отметка ставится до отправки.
 */
export async function claimDmNotice(id: string): Promise<boolean> {
  const { data, error } = await serviceDb()
    .from("community_dm")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", id)
    .is("notified_at", null)
    .select("id");
  check("отметка уведомления не поставлена", error);
  return (data ?? []).length > 0;
}

export type Conversation = {
  with: string;
  name: string | null;
  last: string;
  lastAt: string;
  lastFromMe: boolean;
  unread: number;
  canReply: boolean;
};

const excerpt = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}…` : s);

/** Переписки: по одной строке на автора, свежие сверху; число непрочитанных считается по всем. */
export async function inbox(ctx: TenantContext): Promise<Conversation[]> {
  requireMember(ctx);
  const me = ctx.tenant.id;
  const rows = await pageAll<{
    id: string;
    from_bot_id: string;
    to_bot_id: string;
    body: string;
    read_at: string | null;
    created_at: string;
  }>(
    (from, to) =>
      serviceDb()
        .from("community_dm")
        .select("id, from_bot_id, to_bot_id, body, read_at, created_at")
        .or(`from_bot_id.eq.${me},to_bot_id.eq.${me}`)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    "сообщество: личные сообщения не прочитаны",
  ).catch((e) => {
    if (e instanceof Error && isMissingTable({ message: e.message })) throw new CommunityNotReady();
    throw e;
  });
  const dir = await tenantDirectory();
  const out = new Map<string, Conversation>();
  for (const r of rows) {
    const other = r.from_bot_id === me ? r.to_bot_id : r.from_bot_id;
    let c = out.get(other);
    if (!c) {
      const t = dir.find((x) => x.id === other);
      c = {
        with: other,
        name: t && shownInCommunity(t) ? communityProfile(t.settings).name : null,
        last: excerpt(r.body),
        lastAt: r.created_at,
        lastFromMe: r.from_bot_id === me,
        unread: 0,
        canReply: dmVerdict(ctx.tenant, t) === "ok",
      };
      out.set(other, c);
    }
    if (r.to_bot_id === me && !r.read_at) c.unread++;
  }
  return [...out.values()];
}

/** Сколько непрочитанных у автора (для значка). */
export async function unreadCount(ctx: TenantContext): Promise<number> {
  if (!takesPartInCommunity(ctx.tenant)) return 0;
  const { count, error } = await serviceDb()
    .from("community_dm")
    .select("id", { count: "exact", head: true })
    .eq("to_bot_id", ctx.tenant.id)
    .is("read_at", null);
  check("непрочитанные не посчитаны", error);
  return count ?? 0;
}

export type DmItem = { id: string; body: string; mine: boolean; at: string };
const THREAD_PAGE = 30;

/** Переписка с автором: страница свежих сообщений; первая страница отмечает входящие прочитанными. */
export async function dmThread(
  ctx: TenantContext,
  withId: string,
  offset = 0,
): Promise<{ messages: DmItem[]; next: number | null; canReply: boolean }> {
  requireMember(ctx);
  const me = ctx.tenant.id;
  const from = Math.max(0, Math.floor(offset));
  const { data, error } = await serviceDb()
    .from("community_dm")
    .select("id, from_bot_id, body, created_at")
    .or(
      `and(from_bot_id.eq.${me},to_bot_id.eq.${withId}),and(from_bot_id.eq.${withId},to_bot_id.eq.${me})`,
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + THREAD_PAGE - 1);
  check("переписка не прочитана", error);
  if (from === 0) {
    const { error: re } = await serviceDb()
      .from("community_dm")
      .update({ read_at: new Date().toISOString() })
      .eq("to_bot_id", me)
      .eq("from_bot_id", withId)
      .is("read_at", null);
    check("прочитанное не отмечено", re);
  }
  const rows = data ?? [];
  return {
    messages: rows
      .map((r) => ({ id: r.id, body: r.body, mine: r.from_bot_id === me, at: r.created_at }))
      .reverse(),
    next: rows.length < THREAD_PAGE ? null : from + THREAD_PAGE,
    canReply: dmVerdict(ctx.tenant, await find(withId)) === "ok",
  };
}
