import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { UserError } from "@/core/i18n/user-error";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { serverFailure } from "@/lib/server-failure";
import { CommunityNotReady, isMissingTable } from "./not-ready";
import {
  JOINT,
  allReady,
  cleanEndsAt,
  cleanTerms,
  cleanTitle,
  jointEffective,
  type JointEffective,
  type JointTerms,
} from "./joint";
import { communityProfile, shownInCommunity, takesPartInCommunity } from "./profile";

/**
 * Совместные акции магазинов (С5). Платформа деньги не собирает и не делит: у каждого участника
 * свой обычный промокод в promo_codes своего магазина (создаёт сам участник через ctx.db) и своя
 * скидка за свой счёт; заказы и суммы этот модуль не трогает. Здесь — договорённость и включение
 * кодов, когда согласились все. Таблицы общие для авторов (RLS без политик, migrations/19-4), поэтому
 * serviceDb после проверки согласия; единственная запись платформы в чужую таблицу — включение или
 * выключение промокода участника (`promo_codes.is_active` по его id и его bot_id).
 */
type DbErr = { code?: string | undefined; message: string } | null;
function check(what: string, error: DbErr): void {
  if (!error) return;
  if (isMissingTable(error)) throw new CommunityNotReady();
  throw serverFailure(`совместные акции, ${what}: ${error.message}`);
}

function requireMember(ctx: Pick<TenantContext, "tenant">): void {
  if (!takesPartInCommunity(ctx.tenant)) {
    throw new UserError(
      "err.community.notJoined",
      "Сначала включите «Показывать меня в сообществе» в настройках.",
    );
  }
  if (!ctx.tenant.modules.coupons) {
    throw new UserError("err.joint.noCoupons", "Для совместных акций нужен модуль промокодов.");
  }
}

type PromoRow = {
  id: string;
  created_by: string;
  title: string;
  ends_at: string;
  status: string;
  created_at: string;
};
type MemberRow = {
  id: string;
  promo_id: string;
  bot_id: string;
  status: string;
  code: string | null;
  discount_percent: number | null;
  conditions: string | null;
  promo_code_id: string | null;
};
const PROMO_COLS = "id, created_by, title, ends_at, status, created_at";
const MEMBER_COLS =
  "id, promo_id, bot_id, status, code, discount_percent, conditions, promo_code_id";

async function loadPromo(id: string): Promise<{ promo: PromoRow; members: MemberRow[] } | null> {
  const { data: p, error } = await serviceDb()
    .from("joint_promos")
    .select(PROMO_COLS)
    .eq("id", id)
    .maybeSingle();
  check("акция не прочитана", error);
  if (!p) return null;
  const { data: m, error: me } = await serviceDb()
    .from("joint_promo_members")
    .select(MEMBER_COLS)
    .eq("promo_id", id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  check("участники не прочитаны", me);
  return { promo: p as PromoRow, members: (m ?? []) as MemberRow[] };
}

/** Своя строка промокода магазина — через его собственную роль; неактивна до согласия всех. */
async function insertOwnCode(
  ctx: TenantContext,
  terms: JointTerms,
  endsAt: string,
): Promise<string> {
  const { data, error } = await ctx.db
    .from("promo_codes")
    .insert({
      bot_id: ctx.tenant.id,
      code: terms.code,
      discount_type: "percent",
      discount_value: terms.percent,
      max_uses: null,
      valid_until: endsAt,
      is_active: false,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message))
      throw new UserError("err.admin.codeTaken", "Такой код уже есть.");
    throw serverFailure(`совместные акции, свой промокод не создан: ${error.message}`);
  }
  return data!.id;
}

/** Включить или выключить промокоды участников; идемпотентно, трогает только их строки. */
async function setCodes(members: MemberRow[], active: boolean): Promise<void> {
  for (const m of members) {
    if (!m.promo_code_id) continue;
    const { error } = await serviceDb()
      .from("promo_codes")
      .update({ is_active: active })
      .eq("id", m.promo_code_id)
      .eq("bot_id", m.bot_id);
    if (error)
      throw serverFailure(`совместные акции, промокод участника не переключён: ${error.message}`);
  }
}

/**
 * Если все согласились и у всех есть свой код — включить акцию и коды. Сначала условно занимаем статус
 * proposed→active (выигрывает один вызов), и только победитель включает коды. Потом перечитываем:
 * если акцию успели отменить, коды снова выключаются (cancel сам выключает по свежему списку).
 */
async function settle(promoId: string): Promise<boolean> {
  const full = await loadPromo(promoId);
  if (!full || full.promo.status !== "proposed" || !allReady(full.members)) return false;
  const { data, error } = await serviceDb()
    .from("joint_promos")
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("id", promoId)
    .eq("status", "proposed")
    .select("id");
  check("акция не включена", error);
  if ((data ?? []).length === 0) return false;
  await setCodes(full.members, true);
  const after = await loadPromo(promoId);
  if (!after || after.promo.status !== "active") {
    await setCodes(after?.members ?? full.members, false);
    return false;
  }
  return true;
}

const find = async (id: string): Promise<Tenant | undefined> =>
  (await tenantDirectory()).find((t) => t.id === id);

export type Partner = { id: string; name: string };

/** Авторы, которым можно предложить акцию: в сообществе, не я, с модулем промокодов. */
export async function jointPartners(ctx: TenantContext): Promise<Partner[]> {
  requireMember(ctx);
  return (await tenantDirectory())
    .filter((t) => t.id !== ctx.tenant.id && shownInCommunity(t) && t.modules.coupons)
    .map((t) => ({ id: t.id, name: communityProfile(t.settings).name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function createJointPromo(
  ctx: TenantContext,
  input: { title: unknown; endsAt: unknown; partnerIds: string[]; terms: unknown },
): Promise<{ id: string; invited: string[] }> {
  requireMember(ctx);
  const title = cleanTitle(input.title);
  if (!title) throw new UserError("err.joint.title", "Название акции — от 3 символов.");
  const endsAt = cleanEndsAt(input.endsAt);
  if (!endsAt)
    throw new UserError("err.joint.endsAt", "Дата окончания — в будущем, не дальше чем через год.");
  const partners = [...new Set(input.partnerIds)].filter((id) => id !== ctx.tenant.id);
  if (partners.length + 1 < JOINT.membersMin || partners.length + 1 > JOINT.membersMax)
    throw new UserError("err.joint.members", "В акции 2–3 магазина: вы и один-два автора.");
  const terms = cleanTerms((input.terms ?? {}) as Record<string, unknown>) as ReturnType<
    typeof cleanTerms
  >;
  if (!terms.ok)
    throw terms.error === "code"
      ? new UserError("err.joint.code", "Код — 3–30 символов: латиница, цифры, дефис.")
      : new UserError("err.joint.percent", "Скидка — целое число от 1 до 90 %.");
  for (const id of partners) {
    const t = await find(id);
    if (!t || !shownInCommunity(t) || !t.modules.coupons)
      throw new UserError("err.joint.partner", "Этому автору акцию сейчас предложить нельзя.");
  }
  const endsIso = endsAt.toISOString();
  const { data: promo, error } = await serviceDb()
    .from("joint_promos")
    .insert({
      created_by: ctx.tenant.id,
      title,
      ends_at: endsIso,
      status: "proposed",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  check("акция не создана", error);
  const promoId = promo!.id;
  // Откат: участников удаляем явно, а не только каскадом базы, чтобы не зависеть от внешних ключей.
  const rollback = async () => {
    await serviceDb().from("joint_promo_members").delete().eq("promo_id", promoId);
    await serviceDb().from("joint_promos").delete().eq("id", promoId);
  };
  try {
    const { error: me } = await serviceDb()
      .from("joint_promo_members")
      .insert([
        {
          promo_id: promoId,
          bot_id: ctx.tenant.id,
          status: "accepted",
          code: terms.value.code,
          discount_percent: terms.value.percent,
          conditions: terms.value.conditions || null,
          responded_at: new Date().toISOString(),
        },
        ...partners.map((id) => ({
          promo_id: promoId,
          bot_id: id,
          status: "invited",
        })),
      ]);
    check("участники не добавлены", me);
    const codeId = await insertOwnCode(ctx, terms.value, endsIso);
    const { error: ue } = await serviceDb()
      .from("joint_promo_members")
      .update({ promo_code_id: codeId })
      .eq("promo_id", promoId)
      .eq("bot_id", ctx.tenant.id);
    check("свой код не записан", ue);
  } catch (e) {
    await rollback();
    throw e;
  }
  return { id: promoId, invited: partners };
}

/**
 * Занять право на уведомление о приглашении: условное обновление `notified_at is null`, выигрывает
 * один вызов; отправку, которая могла дойти, не повторяем.
 */
export async function claimInviteNotice(promoId: string, botId: string): Promise<boolean> {
  const { data, error } = await serviceDb()
    .from("joint_promo_members")
    .update({ notified_at: new Date().toISOString() })
    .eq("promo_id", promoId)
    .eq("bot_id", botId)
    .is("notified_at", null)
    .select("id");
  check("отметка уведомления не поставлена", error);
  return (data ?? []).length > 0;
}

export async function acceptJointPromo(
  ctx: TenantContext,
  promoId: string,
  rawTerms: unknown,
): Promise<{ active: boolean }> {
  requireMember(ctx);
  const terms = cleanTerms(rawTerms);
  if (!terms.ok)
    throw terms.error === "code"
      ? new UserError("err.joint.code", "Код — 3–30 символов: латиница, цифры, дефис.")
      : new UserError("err.joint.percent", "Скидка — целое число от 1 до 90 %.");
  const full = await loadPromo(promoId);
  const me = full?.members.find((m) => m.bot_id === ctx.tenant.id);
  if (!full || !me) throw new UserError("err.joint.notFound", "Такой акции нет.");
  if (
    full.promo.status !== "proposed" ||
    jointEffective(full.promo) !== "proposed" ||
    new Date(full.promo.ends_at).getTime() <= Date.now()
  )
    throw new UserError("err.joint.closed", "Акция уже закрыта.");
  // Занимаем согласие условно: двойной клик или два окна дадут один код.
  const { data: claimed, error } = await serviceDb()
    .from("joint_promo_members")
    .update({
      status: "accepted",
      code: terms.value.code,
      discount_percent: terms.value.percent,
      conditions: terms.value.conditions || null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", me.id)
    .eq("status", "invited")
    .select("id");
  check("согласие не записано", error);
  if ((claimed ?? []).length === 0)
    throw new UserError("err.joint.already", "Вы уже ответили на это предложение.");
  try {
    const codeId = await insertOwnCode(ctx, terms.value, full.promo.ends_at);
    const { error: ue } = await serviceDb()
      .from("joint_promo_members")
      .update({ promo_code_id: codeId })
      .eq("id", me.id);
    check("свой код не записан", ue);
  } catch (e) {
    // Код не создался (занят и т. п.): возвращаем приглашение, чтобы ответить ещё раз.
    await serviceDb()
      .from("joint_promo_members")
      .update({
        status: "invited",
        code: null,
        discount_percent: null,
        conditions: null,
        responded_at: null,
      })
      .eq("id", me.id)
      .eq("status", "accepted")
      .is("promo_code_id", null);
    throw e;
  }
  return { active: await settle(promoId) };
}

/** Отказаться от предложения или выйти: акция отменяется целиком, коды участников выключаются. */
export async function declineJointPromo(ctx: TenantContext, promoId: string): Promise<void> {
  requireMember(ctx);
  const full = await loadPromo(promoId);
  if (!full || !full.members.some((m) => m.bot_id === ctx.tenant.id))
    throw new UserError("err.joint.notFound", "Такой акции нет.");
  await cancel(full, ctx.tenant.id);
}

async function cancel(full: { promo: PromoRow; members: MemberRow[] }, byBotId: string) {
  const now = new Date().toISOString();
  const { error } = await serviceDb()
    .from("joint_promos")
    .update({ status: "cancelled", cancelled_at: now })
    .eq("id", full.promo.id)
    .neq("status", "cancelled");
  check("акция не отменена", error);
  const me = full.members.find((m) => m.bot_id === byBotId);
  if (me && me.status === "invited") {
    const { error: de } = await serviceDb()
      .from("joint_promo_members")
      .update({ status: "declined", responded_at: now })
      .eq("id", me.id)
      .eq("status", "invited");
    check("отказ не записан", de);
  }
  // Свежий список: код мог появиться, пока отменяли.
  const fresh = (await loadPromo(full.promo.id))?.members ?? full.members;
  await setCodes(fresh, false);
}

export type JointMemberView = {
  mine: boolean;
  name: string;
  status: "invited" | "accepted" | "declined";
  code: string | null;
  percent: number | null;
  conditions: string | null;
};
export type JointView = {
  id: string;
  title: string;
  endsAt: string;
  status: JointEffective;
  createdByMe: boolean;
  /** Мне ещё надо ответить. */
  needsAnswer: boolean;
  members: JointMemberView[];
};

/** Акции, где участвует магазин: свежие сверху. Чужие условия видны, только когда он согласился. */
export async function listJointPromos(ctx: TenantContext): Promise<JointView[]> {
  requireMember(ctx);
  const me = ctx.tenant.id;
  const { data: mine, error } = await serviceDb()
    .from("joint_promo_members")
    .select("promo_id")
    .eq("bot_id", me)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  check("мои акции не прочитаны", error);
  const ids = [...new Set((mine ?? []).map((r) => r.promo_id))];
  const dir = await tenantDirectory();
  const out: JointView[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: ps, error: pe } = await serviceDb()
      .from("joint_promos")
      .select(PROMO_COLS)
      .in("id", chunk);
    check("акции не прочитаны", pe);
    const { data: ms, error: me2 } = await serviceDb()
      .from("joint_promo_members")
      .select(MEMBER_COLS)
      .in("promo_id", chunk)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    check("участники не прочитаны", me2);
    for (const p of (ps ?? []) as PromoRow[]) {
      const members = ((ms ?? []) as MemberRow[]).filter((m) => m.promo_id === p.id);
      out.push({
        id: p.id,
        title: p.title,
        endsAt: p.ends_at,
        status: jointEffective(p),
        createdByMe: p.created_by === me,
        // Просроченное предложение ответа не ждёт: согласиться уже нельзя.
        needsAnswer:
          p.status === "proposed" &&
          new Date(p.ends_at).getTime() > Date.now() &&
          members.some((m) => m.bot_id === me && m.status === "invited"),
        members: members.map((m) => {
          const t = dir.find((x) => x.id === m.bot_id);
          const own = m.bot_id === me;
          return {
            mine: own,
            name: t ? communityProfile(t.settings).name || t.name : "—",
            status: m.status as JointMemberView["status"],
            code: own || m.status === "accepted" ? m.code : null,
            percent: own || m.status === "accepted" ? m.discount_percent : null,
            conditions: own || m.status === "accepted" ? m.conditions : null,
          };
        }),
      });
    }
  }
  return out.sort((a, b) => b.endsAt.localeCompare(a.endsAt) || a.id.localeCompare(b.id));
}

export type BannerPartner = {
  name: string;
  slug: string | null;
  code: string;
  percent: number;
  conditions: string;
};
export type PartnerBanner = {
  title: string;
  endsAt: string;
  mine: { code: string; percent: number; conditions: string };
  partners: BannerPartner[];
};

/**
 * «Акция партнёров» на витрине магазина: идущие акции, где он участвует. Показываем, только пока
 * все участники в сообществе и не скрыты (согласие отозвали — акцию не рекламируем), а промокод
 * каждого участника по-прежнему включён и не просрочен: цифры берутся из его настоящих строк
 * promo_codes, а не из договорённости.
 */
export async function partnerBanners(
  ctx: Pick<TenantContext, "tenant">,
  now: Date = new Date(),
): Promise<PartnerBanner[]> {
  const me = ctx.tenant.id;
  if (!shownInCommunity(ctx.tenant)) return [];
  const { data: mine, error } = await serviceDb()
    .from("joint_promo_members")
    .select("promo_id")
    .eq("bot_id", me)
    .eq("status", "accepted");
  check("акции витрины не прочитаны", error);
  const ids = [...new Set((mine ?? []).map((r) => r.promo_id))];
  const dir = await tenantDirectory();
  const out: PartnerBanner[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: ps, error: pe } = await serviceDb()
      .from("joint_promos")
      .select(PROMO_COLS)
      .in("id", chunk)
      .eq("status", "active")
      .gt("ends_at", now.toISOString());
    check("акции не прочитаны", pe);
    const promos = (ps ?? []) as PromoRow[];
    // Участники всех акций пачки одним чтением (а не по запросу на акцию).
    const members = await pageAll<MemberRow>(
      (from, to) =>
        serviceDb()
          .from("joint_promo_members")
          .select(MEMBER_COLS)
          .in(
            "promo_id",
            promos.map((p) => p.id),
          )
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      "участники не прочитаны",
    );
    const ready = promos.flatMap((p) => {
      const ms = members.filter((m) => m.promo_id === p.id);
      if (!allReady(ms)) return [];
      const tenants = ms.map((m) => dir.find((t) => t.id === m.bot_id));
      return tenants.some((t) => !t || !shownInCommunity(t)) ? [] : [{ p, members: ms }];
    });
    // Промокоды всех готовых акций — кусками по 200 id.
    const codeIds = [...new Set(ready.flatMap((r) => r.members.map((m) => m.promo_code_id!)))];
    const live = new Map<string, { code: string; discount_value: number | string }>();
    for (let j = 0; j < codeIds.length; j += 200) {
      const { data: codes, error: ce } = await serviceDb()
        .from("promo_codes")
        .select("id, bot_id, code, discount_value, is_active, valid_until")
        .in("id", codeIds.slice(j, j + 200));
      check("промокоды акции не прочитаны", ce);
      for (const c of codes ?? [])
        if (c.is_active && (!c.valid_until || new Date(c.valid_until).getTime() > now.getTime()))
          live.set(c.id, c);
    }
    for (const { p, members: ms } of ready) {
      if (ms.some((m) => !live.has(m.promo_code_id!))) continue;
      const row = (m: MemberRow) => ({
        code: live.get(m.promo_code_id!)!.code,
        percent: Number(live.get(m.promo_code_id!)!.discount_value),
        conditions: m.conditions ?? "",
      });
      const mineM = ms.find((m) => m.bot_id === me)!;
      out.push({
        title: p.title,
        endsAt: p.ends_at,
        mine: row(mineM),
        partners: ms
          .filter((m) => m.bot_id !== me)
          .map((m) => {
            const t = dir.find((x) => x.id === m.bot_id)!;
            return {
              name: communityProfile(t.settings).name,
              slug: t.settings.slug ?? null,
              ...row(m),
            };
          }),
      });
    }
  }
  return out.sort((a, b) => a.endsAt.localeCompare(b.endsAt) || a.title.localeCompare(b.title));
}

/** Таблицы совместных акций есть (для вкладки). */
export async function jointReady(ctx: Pick<TenantContext, "tenant">): Promise<boolean> {
  if (!takesPartInCommunity(ctx.tenant) || !ctx.tenant.modules.coupons) return false;
  const { error } = await serviceDb()
    .from("joint_promos")
    .select("id", { count: "exact", head: true });
  if (error && isMissingTable(error)) return false;
  check("таблица акций не прочитана", error);
  return true;
}
