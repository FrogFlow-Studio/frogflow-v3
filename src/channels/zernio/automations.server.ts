/**
 * Comment-to-DM в Instagram через Zernio: правила живут у Zernio
 * (`/comment-automations`), наши дополнения к ним (двухшаговая DM, текст
 * второго сообщения, публичная просьба написать в директ) — в
 * `app_settings.ig_comment_automations_meta` клиента, тем же ключом, что в
 * v1: клиент переезжает без потери настроек. Резервный крон и догоняющая
 * рассылка — по описи docs/inherited-knowledge.md; чистые правила — в
 * `core/instagram/comment-rules.ts`.
 */
import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import { inChunks } from "@/lib/in-chunks";
import { getSetting, setSetting } from "@/core/settings/settings";
import {
  DEFAULT_REPLY_PROMPT,
  DEFAULT_SECOND_DM,
  DM_LIMIT_PLAIN,
  LEGACY_REPLY_PROMPTS,
  annotateCommentStatus,
  buildAutomationBody,
  commentAgeVerdict,
  commentMatchesAutomation,
  commentPrivateReplyBlockReason,
  describePostMediaKind,
  explainInstagramPrivateReplyError,
  commentCoveredByLogs,
  commentIdsHandledByZernio,
  commenterIdsOf,
  FALLBACK_MAX_AGE_MS,
  isPrivateReplyAlreadySent,
  logCoverage,
  logsReachBack,
  LOG_MAX_PAGES,
  LOG_PAGE_SIZE,
  type LogCoverage,
  fallbackRecordStatus,
  isInstagramMediaId,
  isZernioObjectId,
  pickZernioPostId,
  stalePendingAction,
  STALE_PENDING_MS,
  stripReplyPrompt,
  withReplyPrompt,
  REPEAT_COOLDOWN_HOURS,
  REPEAT_POLICY,
  repeatPolicyOk,
  type AutomationButton,
  type AutomationInput,
  type MatchMode,
} from "@/core/instagram/comment-rules";
import {
  listConversationMessages,
  normalizeDmButtons,
  sendInboxMessage,
  zernioRequest,
  type DmButton,
} from "./api.server";
import type { ZernioInboxMessage } from "./inbox-types";
import { ZernioApiError, classifyZernioFailure } from "./errors";
import { serverFailure } from "@/lib/server-failure";
import { fill, type UserErrorVars } from "@/core/i18n/user-error";
import { toJson } from "@/core/json";

export type CommentAutomation = {
  id?: string;
  _id?: string;
  name: string;
  platform?: string;
  trigger?: "comment" | "story_reply";
  accountId: string;
  profileId?: string;
  platformPostId?: string | null;
  postId?: string | null;
  postTitle?: string;
  keywords: string[];
  matchMode?: MatchMode;
  dmMessage: string;
  buttons?: AutomationButton[];
  commentReply?: string;
  dmMessageVariations?: string[];
  commentReplyVariations?: string[];
  linkTracking?: boolean;
  clickTag?: string;
  isActive?: boolean;
  /** Повтор первого сообщения одному человеку (Zernio): once | every_comment (+ cooldownHours). */
  repeatPolicy?: { mode?: string; cooldownHours?: number } | null;
  createdAt?: string;
  stats?: {
    triggered?: number;
    dmsSent?: number;
    dmsFailed?: number;
    uniqueContacts?: number;
    linkClicks?: number;
  };
  /* наши поля из мета */
  twoStepDm?: boolean;
  secondDmMessage?: string;
  secondDmButtons?: AutomationButton[];
  unresolvedPrompt?: string;
  /** Призыв в конце первого сообщения («Ответьте «+»…»); "" — без призыва. */
  replyPrompt?: string;
  /** Первое сообщение целиком, как у Zernio (текст продавца + призыв). */
  firstMessage?: string;
};

export type AutomationMeta = {
  twoStepDm?: boolean;
  secondDmMessage?: string;
  secondDmButtons?: AutomationButton[];
  /** Публичный ответ «напишите нам в директ», если DM не доставилась никак. */
  unresolvedPrompt?: string;
  /**
   * Призыв ответить, дописанный в конец первого сообщения у Zernio: без
   * ответа покупателя второе сообщение с кнопками не уйдёт. "" — без призыва.
   */
  replyPrompt?: string;
  /**
   * Повтор «не чаще раза в сутки» у Zernio: "ok" — поставлен, при чтении не
   * трогаем, даже если Zernio не вернул поле в списке; время (ISO) — Zernio
   * отказал, следующая попытка через сутки.
   */
  repeatPolicySetAt?: string;
};

export type InstagramComment = {
  id?: string;
  message?: string;
  createdTime?: string;
  from?: { id?: string; name?: string; username?: string; isOwner?: boolean };
  likeCount?: number;
  replyCount?: number;
  canReply?: boolean;
  isHidden?: boolean;
  parentId?: string | null;
};

export type AutomationLog = Record<string, Json>;

/** Вызовы Zernio, которые подменяются в тестах. */
export type AutomationApi = {
  list: (profileId?: string) => Promise<CommentAutomation[]>;
  create: (body: Record<string, unknown>) => Promise<CommentAutomation>;
  update: (id: string, body: Record<string, unknown>) => Promise<CommentAutomation>;
  remove: (id: string) => Promise<void>;
  logs: (
    id: string,
    opts: { limit?: number; skip?: number; status?: "sent" | "failed" | "skipped" },
  ) => Promise<AutomationLog[]>;
  /** `shouldStop` — бюджет времени кончился: чтение прерывается исключением CommentsStopped, обрезанного списка не отдаём. */
  comments: (
    postId: string,
    accountId: string,
    shouldStop?: () => boolean,
  ) => Promise<InstagramComment[]>;
  privateReply: (
    postId: string,
    commentId: string,
    accountId: string,
    message: string,
    buttons: AutomationButton[],
  ) => Promise<{ ok: boolean; error?: string; rateLimitedSec?: number }>;
  publicReply: (
    postId: string,
    commentId: string,
    accountId: string,
    message: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  inbox: typeof sendInboxMessage;
  /** Хвост переписки — проверить, не ушло ли второе сообщение до сбоя. */
  tail: (accountId: string, conversationId: string) => Promise<ZernioInboxMessage[]>;
};

const COMMENTS_MAX_PAGES = 20;

/** Чтение комментариев прервано по бюджету времени: неполный список использовать нельзя (дубль DM тем, кто уже получил). */
export class CommentsStopped extends Error {
  constructor() {
    super("чтение комментариев прервано: бюджет времени крона");
    this.name = "CommentsStopped";
  }
}

export const liveAutomationApi: AutomationApi = {
  list: async (profileId) => {
    const r = await zernioRequest<{ automations?: CommentAutomation[] }>("/comment-automations", {
      query: profileId ? { profileId } : undefined,
    });
    return r.automations ?? [];
  },
  create: async (body) => {
    const r = await zernioRequest<{
      success?: boolean;
      automation?: CommentAutomation;
      error?: string;
    }>("/comment-automations", { method: "POST", body });
    if (r.success === false || !r.automation)
      throw new Error(r.error || "Zernio не создал правило");
    return r.automation;
  },
  update: async (id, body) => {
    const r = await zernioRequest<{
      success?: boolean;
      automation?: CommentAutomation;
      error?: string;
    }>(`/comment-automations/${encodeURIComponent(id)}`, { method: "PATCH", body });
    if (r.success === false) throw new Error(r.error || "Zernio не обновил правило");
    return r.automation ?? ({ id } as CommentAutomation);
  },
  remove: async (id) => {
    await zernioRequest(`/comment-automations/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  logs: async (id, opts) => {
    const query: Record<string, string> = {};
    if (opts.limit) query.limit = String(opts.limit);
    if (opts.skip) query.skip = String(opts.skip);
    if (opts.status) query.status = opts.status;
    const r = await zernioRequest<{ logs?: AutomationLog[] }>(
      `/comment-automations/${encodeURIComponent(id)}/logs`,
      Object.keys(query).length ? { query } : {},
    );
    return r.logs ?? [];
  },
  // GET /inbox/comments/{postId}: accountId — строго query; явный limit не
  // передаём (Instagram отвечал Platform error: 100); ходим по cursor.
  comments: async (postId, accountId, shouldStop) => {
    const all: InstagramComment[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < COMMENTS_MAX_PAGES; page++) {
      if (page > 0 && shouldStop?.()) throw new CommentsStopped();
      const query: Record<string, string> = { accountId };
      if (cursor) query.cursor = cursor;
      const r = await zernioRequest<{
        comments?: InstagramComment[];
        pagination?: { hasMore?: boolean; cursor?: string };
      }>(`/inbox/comments/${encodeURIComponent(postId)}`, { query, timeoutMs: 20_000 });
      all.push(...(r.comments ?? []));
      if (r.pagination?.hasMore !== true || !r.pagination.cursor) break;
      cursor = r.pagination.cursor;
    }
    return all;
  },
  // Zernio отклоняет buttons: [] — поле либо не передаём, либо с кнопкой.
  privateReply: async (postId, commentId, accountId, message, buttons) => {
    const body: Record<string, unknown> = { accountId, message };
    const b = normalizeDmButtons(buttons as DmButton[]);
    if (b.length) body.buttons = b;
    try {
      await zernioRequest(
        `/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/private-reply`,
        { method: "POST", body, idempotencyKey: `catchup-reply:${postId}:${commentId}` },
      );
      return { ok: true };
    } catch (e) {
      const limited = rateLimitOf(e);
      return {
        ok: false,
        error: explainInstagramPrivateReplyError(e instanceof Error ? e.message : String(e)),
        ...(limited !== null ? { rateLimitedSec: limited } : {}),
      };
    }
  },
  // Тот же путь без commentId — публикация НОВОГО комментария, поэтому commentId обязателен.
  publicReply: async (postId, commentId, accountId, message) => {
    try {
      await zernioRequest(`/inbox/comments/${encodeURIComponent(postId)}`, {
        method: "POST",
        body: { accountId, message, commentId },
        idempotencyKey: `catchup-public-reply:${postId}:${commentId}`,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  inbox: sendInboxMessage,
  tail: listConversationMessages,
};

/* ── мета правил в app_settings ──────────────────────────────────────── */

const META_KEY = "ig_comment_automations_meta";

export async function getAutomationsMeta(
  ctx: TenantContext,
): Promise<Record<string, AutomationMeta>> {
  const raw = await getSetting(ctx, META_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, AutomationMeta>)
      : {};
  } catch {
    return {};
  }
}

export async function setAutomationMeta(
  ctx: TenantContext,
  automationId: string,
  meta: AutomationMeta | null,
): Promise<void> {
  const current = await getAutomationsMeta(ctx);
  if (meta) current[automationId] = { ...current[automationId], ...meta };
  else delete current[automationId];
  await setSetting(ctx, META_KEY, JSON.stringify(current));
}

/* ── список и сохранение ─────────────────────────────────────────────── */

export const automationId = (a: { id?: string; _id?: string }): string =>
  String(a.id || a._id || "");

export function ownsZernioAccount(ctx: TenantContext, accountId: string): boolean {
  const z = ctx.tenant.settings.zernio;
  return Boolean(
    z?.accounts?.some((a) => a.id === accountId) || z?.account_ids?.includes(accountId),
  );
}

export function instagramAccounts(ctx: TenantContext) {
  return (ctx.tenant.settings.zernio?.accounts ?? [])
    .filter((a) => a.platform === "instagram")
    .map((a) => ({
      id: a.id,
      name: a.username ? `@${a.username}` : (a.name ?? a.id),
      expired: a.expired,
    }));
}

/** Правила клиента: по его профилю Zernio, и только по его аккаунтам. */
export async function listAutomations(
  ctx: TenantContext,
  api: AutomationApi = liveAutomationApi,
): Promise<CommentAutomation[]> {
  const z = ctx.tenant.settings.zernio;
  if (!z?.profile_id && !z?.accounts?.length && !z?.account_ids?.length) return [];
  const [all, meta] = await Promise.all([api.list(z.profile_id), getAutomationsMeta(ctx)]);
  const own = all.filter((a) => ownsZernioAccount(ctx, a.accountId));
  await upgradeLegacyButtons(ctx, own, meta, api);
  await upgradeReplyPrompt(ctx, own, meta, api);
  await upgradeRepeatPolicy(ctx, own, meta, api);
  return own.map((a) => {
    const m = meta[automationId(a)];
    if (!m) return { ...a, firstMessage: a.dmMessage };
    return {
      ...a,
      // В форме — текст продавца без призыва: при сохранении он допишется снова.
      dmMessage: stripReplyPrompt(a.dmMessage ?? "", m.replyPrompt),
      firstMessage: a.dmMessage,
      twoStepDm: m.twoStepDm,
      secondDmMessage: m.secondDmMessage,
      secondDmButtons: m.secondDmButtons,
      unresolvedPrompt: m.unresolvedPrompt,
      // Правило из двух шагов, сохранённое до призыва: "" — чтобы пересохранение
      // не поменяло текст, который продавец писал сам.
      replyPrompt: m.twoStepDm ? (m.replyPrompt ?? "") : undefined,
      buttons: m.twoStepDm && m.secondDmButtons?.length ? m.secondDmButtons : a.buttons,
    };
  });
}

/**
 * Правило, сохранённое раньше (в том числе в v1), у Zernio хранит кнопки
 * первого сообщения: Zernio шлёт их в private-reply, а Instagram не
 * показывает кнопки тем, кто не подписан, и тратит на отказ единственный
 * ответ на комментарий. Приводим такое правило к новому виду при чтении,
 * без пересохранения продавцом: кнопки — в мету второго сообщения (сначала
 * мета, чтобы кнопки не потерялись), затем PATCH `buttons: []` — у Zernio
 * это очистка кнопок, id и счётчики правила остаются. В тот же PATCH —
 * призыв ответить в конце первого сообщения (если влезает в 1000 символов):
 * без ответа покупателя кнопки не уйдут. Ответ на историю
 * (story_reply) не трогаем: там покупатель уже написал сам. Только клиенты
 * v2: правила клиента прежней платформы ведёт v1.
 */
async function upgradeLegacyButtons(
  ctx: TenantContext,
  rules: CommentAutomation[],
  meta: Record<string, AutomationMeta>,
  api: AutomationApi,
): Promise<void> {
  if (!servedByV2(ctx.tenant)) return;
  for (const a of rules) {
    const id = automationId(a);
    if (!id || a.trigger === "story_reply" || !a.buttons?.length) continue;
    const m = meta[id] ?? {};
    let prompt = m.replyPrompt ?? DEFAULT_REPLY_PROMPT;
    let first = withReplyPrompt(a.dmMessage ?? "", prompt);
    if (first.length > DM_LIMIT_PLAIN) {
      prompt = "";
      first = a.dmMessage ?? "";
    }
    const next: AutomationMeta = {
      ...m,
      twoStepDm: true,
      secondDmButtons: m.secondDmButtons?.length ? m.secondDmButtons : a.buttons,
      replyPrompt: prompt,
    };
    try {
      await setAutomationMeta(ctx, id, next);
      meta[id] = next;
      await api.update(
        id,
        first === a.dmMessage ? { buttons: [] } : { buttons: [], dmMessage: first },
      );
      a.buttons = [];
      a.dmMessage = first;
    } catch (e) {
      console.warn(
        `[comment-dm] ${ctx.tenant.id}: правило ${id} не приведено к двум шагам: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}

/**
 * Призыв по умолчанию сменился (LEGACY_REPLY_PROMPTS → DEFAULT_REPLY_PROMPT):
 * правило, чьё первое сообщение кончается прежним призывом по умолчанию,
 * получает новый при чтении, без пересохранения продавцом. Текст продавца
 * не трогаем — меняется только наш хвост. Сначала Zernio, потом мета: упала
 * мета — при следующем чтении текст уже с новым призывом, дописываем только
 * мету. Время замены — строка `comment_rule.prompt_upgraded` в журнале: от
 * неё меряем долю ответивших до и после. Только клиенты v2.
 */
async function upgradeReplyPrompt(
  ctx: TenantContext,
  rules: CommentAutomation[],
  meta: Record<string, AutomationMeta>,
  api: AutomationApi,
): Promise<void> {
  if (!servedByV2(ctx.tenant)) return;
  const legacy: readonly string[] = LEGACY_REPLY_PROMPTS;
  for (const a of rules) {
    const id = automationId(a);
    const m = meta[id];
    if (!id || a.trigger === "story_reply" || !m?.twoStepDm) continue;
    const old = m.replyPrompt?.trim() ?? "";
    if (!legacy.includes(old)) continue;
    const dm = a.dmMessage ?? "";
    const base = stripReplyPrompt(dm, old);
    const next = withReplyPrompt(base, DEFAULT_REPLY_PROMPT);
    const textHasOld = base !== dm;
    // Продавец убрал призыв из текста сам — не возвращаем; текст уже с новым — дописываем мету.
    if (!textHasOld && stripReplyPrompt(dm, DEFAULT_REPLY_PROMPT) === dm) continue;
    if (next.length > DM_LIMIT_PLAIN) continue;
    try {
      if (textHasOld) await api.update(id, { dmMessage: next });
      const nextMeta: AutomationMeta = { ...m, replyPrompt: DEFAULT_REPLY_PROMPT };
      await setAutomationMeta(ctx, id, nextMeta);
      meta[id] = nextMeta;
      if (textHasOld) a.dmMessage = next;
      await upsertLog(ctx, `prompt-upgrade:${id}`, {
        event_type: "comment_rule.prompt_upgraded",
        status: "processed",
        payload: { automationId: id, from: old, to: DEFAULT_REPLY_PROMPT, textChanged: textHasOld },
      });
    } catch (e) {
      console.warn(
        `[comment-dm] ${ctx.tenant.id}: правилу ${id} не обновлён призыв: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}

/**
 * Одно первое сообщение на человека за сутки (решение Якова 11.10, 7): его шлёт
 * Zernio своим правилом, а правило без `repeatPolicy` отвечало на каждый
 * комментарий — vertsanova.svetlana под «Палитрой» за минуту получила два
 * одинаковых. Правило, у которого повтор не ограничен, при чтении получает
 * `every_comment` + 24 ч, без пересохранения продавцом; «один раз навсегда»
 * (once) строже — не трогаем. Отметка в мете — чтобы не слать PATCH на каждом
 * чтении, если Zernio не вернёт поле в списке; отказ Zernio — повтор через
 * сутки. Ответ на историю (story_reply) не трогаем. Только клиенты v2.
 */
async function upgradeRepeatPolicy(
  ctx: TenantContext,
  rules: CommentAutomation[],
  meta: Record<string, AutomationMeta>,
  api: AutomationApi,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (!servedByV2(ctx.tenant)) return;
  for (const a of rules) {
    const id = automationId(a);
    if (!id || a.trigger === "story_reply" || repeatPolicyOk(a.repeatPolicy)) continue;
    const m = meta[id] ?? {};
    if (m.repeatPolicySetAt === "ok") continue;
    const failedAt = Date.parse(m.repeatPolicySetAt ?? "");
    if (Number.isFinite(failedAt) && now().getTime() - failedAt < REPEAT_COOLDOWN_HOURS * 3_600_000)
      continue;
    const before = toJson(a.repeatPolicy ?? null);
    let mark = "ok";
    try {
      await api.update(id, { repeatPolicy: REPEAT_POLICY });
      a.repeatPolicy = { ...REPEAT_POLICY };
    } catch (e) {
      // Отказ Zernio — попробуем через сутки, не на каждом чтении.
      mark = now().toISOString();
      console.warn(
        `[comment-dm] ${ctx.tenant.id}: правилу ${id} не поставлен повтор раз в сутки: ${e instanceof Error ? e.message : e}`,
      );
    }
    try {
      const next: AutomationMeta = { ...m, repeatPolicySetAt: mark };
      await setAutomationMeta(ctx, id, next);
      meta[id] = next;
    } catch (e) {
      console.warn(
        `[comment-dm] ${ctx.tenant.id}: отметка повтора правила ${id} не записана: ${e instanceof Error ? e.message : e}`,
      );
    }
    if (mark === "ok")
      await upsertLog(ctx, `repeat-policy:${id}`, {
        event_type: "comment_rule.repeat_policy",
        status: "processed",
        payload: { automationId: id, from: before, to: toJson(REPEAT_POLICY) },
      }).catch(() => undefined);
  }
}

export type SaveAutomationInput = AutomationInput & {
  id?: string;
  original?: { platformPostId?: string | null; postId?: string | null; trigger?: string };
  replyToAll?: boolean;
};

/**
 * Создать или обновить правило. PATCH у Zernio не меняет пост и триггер —
 * при их смене правило пересоздаётся (и теряет счётчики); «все посты» в
 * обеих формах (null/undefined) — одно и то же «нет поста».
 */
const POST_TAKEN_KEY = "err.instagram.postTaken";
const POST_TAKEN_TEXT =
  "На этот пост уже есть правило «{name}». Измените его или выключите, потом сохраните это.";

export async function saveAutomation(
  ctx: TenantContext,
  input: SaveAutomationInput,
  api: AutomationApi = liveAutomationApi,
): Promise<
  { ok: true; id: string } | { ok: false; error: string; key?: string; vars?: UserErrorVars }
> {
  if (!ownsZernioAccount(ctx, input.accountId))
    return { ok: false, error: "Этот аккаунт Instagram не подключён к вашему магазину." };
  if (input.platformPostId && input.platformPostId === input.accountId)
    return { ok: false, error: "Выбран id аккаунта вместо id публикации. Выберите пост заново." };
  if (input.platformPostId) {
    if (!input.postId || isInstagramMediaId(input.postId) || !isZernioObjectId(input.postId))
      return {
        ok: false,
        error:
          "У выбранного поста нет id записи в Zernio — правило сохранится, но комментарии под ним не найдут его. Вставьте ссылку на публикацию и выберите пост заново.",
      };
  }
  const { id, original, replyToAll, ...rest } = input;
  const data: AutomationInput = { ...rest };
  // Кнопки — всегда вторым сообщением: private-reply с кнопками Instagram не
  // доставляет тем, кто не подписан на аккаунт, и тратит на отказ единственный
  // ответ на комментарий (buildAutomationBody кнопки правилу Zernio не отдаёт).
  // Второе уходит только после ответа покупателя — первое по умолчанию просит
  // ответить.
  const twoStep = Boolean(data.twoStepDm) || Boolean(data.buttons?.length);
  const replyPrompt = twoStep ? (data.replyPrompt ?? DEFAULT_REPLY_PROMPT).trim() : "";
  data.dmMessage = withReplyPrompt(data.dmMessage ?? "", replyPrompt);
  const specificPost = Boolean(data.platformPostId);
  if (replyToAll && specificPost) data.keywords = [];
  else if (!data.keywords?.length && !specificPost)
    return { ok: false, error: "Для правила на все посты нужно хотя бы одно ключевое слово." };
  if (!data.profileId) {
    const { ensureTenantProfile } = await import("./connect.server");
    data.profileId = await ensureTenantProfile(ctx.tenant);
  }
  let body: Record<string, unknown>;
  try {
    body = buildAutomationBody(data);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // Одно первое сообщение на человека за сутки (upgradeRepeatPolicy).
  const repeatLimited = (data.trigger || "comment") !== "story_reply";
  if (repeatLimited) body.repeatPolicy = REPEAT_POLICY;
  const meta: AutomationMeta = {
    twoStepDm: twoStep,
    secondDmMessage: data.secondDmMessage?.trim() || undefined,
    secondDmButtons: twoStep ? (data.buttons ?? []) : undefined,
    unresolvedPrompt: data.unresolvedPrompt?.trim() || undefined,
    replyPrompt: twoStep ? replyPrompt : undefined,
    ...(repeatLimited ? { repeatPolicySetAt: "ok" } : {}),
  };
  const norm = (v: string | null | undefined) => v || null;
  try {
    let savedId: string;
    if (
      id &&
      norm(original?.platformPostId) === norm(data.platformPostId) &&
      norm(original?.postId) === norm(data.postId) &&
      (original?.trigger || "comment") === (data.trigger || "comment")
    ) {
      // PATCH: пост и триггер не менять — Zernio их не принимает. Поле, которого
      // нет в PATCH, Zernio оставляет как было: кнопки старого правила снимает
      // только явный `buttons: []`.
      const { platformPostId: _p, postId: _z, trigger: _t, ...patch } = body;
      void _p;
      void _z;
      void _t;
      await api.update(id, { ...patch, buttons: [] });
      savedId = id;
    } else {
      // Zernio держит одно активное правило на пост (409 «An active automation
      // already exists for this post»). Чужое правило на этом посте — отказ
      // продавцу с его названием; своё (пост переставили или у поста сменился
      // id) — выключаем на время создания и включаем обратно, если создать
      // не вышло: правило не должно пропасть из-за неудачного сохранения.
      let pausedOld = false;
      const own =
        data.platformPostId || id
          ? (await api.list(data.profileId)).filter((a) => ownsZernioAccount(ctx, a.accountId))
          : [];
      if (data.platformPostId) {
        const other = own.find(
          (a) =>
            automationId(a) !== id &&
            a.isActive !== false &&
            a.platformPostId === data.platformPostId &&
            (a.trigger || "comment") === (data.trigger || "comment"),
        );
        if (other)
          return {
            ok: false,
            error: fill(POST_TAKEN_TEXT, { name: other.name }),
            key: POST_TAKEN_KEY,
            vars: { name: other.name },
          };
      }
      // Старое правило выключаем всегда, а не только на том же посте: правило
      // «на все посты» Zernio, возможно, тоже считает занявшим пост.
      if (id && own.some((a) => automationId(a) === id && a.isActive !== false)) {
        await api.update(id, { isActive: false });
        pausedOld = true;
      }
      let created: CommentAutomation;
      try {
        created = await api.create(body);
      } catch (e) {
        if (pausedOld && id) await api.update(id, { isActive: true });
        throw e;
      }
      savedId = automationId(created);
      if (!savedId) {
        if (pausedOld && id) await api.update(id, { isActive: true });
        return { ok: false, error: "Zernio не вернул id правила" };
      }
      if (id) {
        await api.remove(id);
        await setAutomationMeta(ctx, id, null);
      }
    }
    await setAutomationMeta(ctx, savedId, meta);
    return { ok: true, id: savedId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function ownedAutomation(
  ctx: TenantContext,
  id: string,
  api: AutomationApi,
): Promise<CommentAutomation | null> {
  return (await listAutomations(ctx, api)).find((a) => automationId(a) === id) ?? null;
}

export async function deleteAutomation(
  ctx: TenantContext,
  id: string,
  api: AutomationApi = liveAutomationApi,
): Promise<boolean> {
  if (!(await ownedAutomation(ctx, id, api))) return false;
  await api.remove(id);
  await setAutomationMeta(ctx, id, null);
  return true;
}

export async function toggleAutomation(
  ctx: TenantContext,
  id: string,
  isActive: boolean,
  api: AutomationApi = liveAutomationApi,
): Promise<boolean> {
  if (!(await ownedAutomation(ctx, id, api))) return false;
  await api.update(id, { isActive });
  return true;
}

export async function automationLogs(
  ctx: TenantContext,
  id: string,
  opts: { limit?: number; skip?: number; onlyFailed?: boolean },
  api: AutomationApi = liveAutomationApi,
): Promise<AutomationLog[]> {
  if (!(await ownedAutomation(ctx, id, api))) return [];
  return api.logs(id, {
    limit: opts.limit ?? 100,
    skip: opts.skip,
    status: opts.onlyFailed ? "failed" : undefined,
  });
}

/* ── посты ───────────────────────────────────────────────────────────── */

export type PostSummary = {
  platformPostId: string;
  zernioPostId: string | null;
  caption: string;
  thumbnail: string | null;
  publishedAt: string | null;
  kind: string;
  permalink: string | null;
};

type RawPost = Record<string, Json | undefined>;
const asObj = (v: Json | undefined): RawPost =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as RawPost) : {};
const asArr = (v: Json | undefined): RawPost[] => (Array.isArray(v) ? (v as RawPost[]) : []);
const asText = (v: Json | undefined): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

function normalizePost(p: RawPost, accountId: string, captionMax = 200): PostSummary | null {
  const platform = [...asArr(p.platformAnalytics), ...asArr(p.platforms)].find(
    (x) => asText(x.accountId) === accountId || x.platform === "instagram",
  );
  const metadata = asObj(p.metadata);
  const platformPostId =
    asText(platform?.platformPostId) || asText(p.platformPostId) || asText(metadata.platformPostId);
  if (!platformPostId) return null;
  const media = asArr(p.mediaItems)[0];
  const rawDate =
    asText(p.publishedAt) ||
    asText(metadata.publishedAt) ||
    asText(metadata.timestamp) ||
    asText(p.timestamp) ||
    asText(platform?.publishedAt) ||
    "";
  const ts = /^\d+$/.test(rawDate)
    ? Number(rawDate) * (Number(rawDate) < 1e11 ? 1000 : 1)
    : rawDate;
  const d = ts ? new Date(ts) : null;
  return {
    platformPostId,
    zernioPostId: pickZernioPostId(p),
    // Для правил — строка до 200 знаков; импорт товаров берёт подпись целиком, с переносами.
    caption:
      captionMax > 200
        ? (
            asText(p.caption) ||
            asText(p.text) ||
            asText(p.content) ||
            asText(metadata.caption)
          ).slice(0, captionMax)
        : (asText(p.caption) || asText(p.text) || asText(p.content) || asText(metadata.caption))
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, captionMax),
    thumbnail: asText(p.thumbnailUrl) || asText(media?.thumbnail) || asText(media?.url) || null,
    publishedAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
    kind: describePostMediaKind({
      mediaProductType:
        p.mediaProductType ?? platform?.mediaProductType ?? metadata.mediaProductType,
      mediaType: p.mediaType ?? platform?.mediaType ?? metadata.mediaType,
      type: p.type,
    }),
    permalink: asText(p.platformPostUrl) || asText(p.permalink) || null,
  };
}

/**
 * Посты аккаунта для выбора в правиле. analytics — источник media id
 * Instagram; sync-external — свежий пост, которого фоновая синхронизация
 * Zernio (раз в ~90 минут) ещё не видела; /posts — id записи Zernio.
 */
export async function listPosts(
  ctx: TenantContext,
  accountId: string,
  captionMax = 200,
): Promise<PostSummary[]> {
  if (!ownsZernioAccount(ctx, accountId)) return [];
  const settled = await Promise.allSettled([
    zernioRequest<{ posts?: RawPost[] }>("/analytics", {
      query: { accountId, platform: "instagram", source: "all", limit: "50" },
    }),
    zernioRequest<{ posts?: RawPost[] }>("/posts/sync-external", {
      method: "POST",
      body: { accountId },
    }),
    zernioRequest<{ posts?: RawPost[] }>("/posts", {
      query: { accountId, source: "external", limit: "50" },
    }),
    zernioRequest<{ posts?: RawPost[] }>("/posts", {
      query: { accountId, source: "zernio", limit: "50" },
    }),
  ]);
  // Все четыре запроса отказали — это не «публикаций нет», а Zernio не пускает
  // (ключ не видит профиль, аккаунт отключён) или лежит: продавцу — причину.
  const firstFailure = settled.find((r) => r.status === "rejected");
  if (firstFailure && settled.every((r) => r.status === "rejected"))
    throw (firstFailure as PromiseRejectedResult).reason;
  const lists = settled.map((r) => (r.status === "fulfilled" ? (r.value.posts ?? []) : []));
  const byPlatformId = new Map<string, PostSummary>();
  for (const raw of lists.flat()) {
    const p = normalizePost(raw, accountId, captionMax);
    if (!p) continue;
    const prev = byPlatformId.get(p.platformPostId);
    byPlatformId.set(p.platformPostId, {
      ...(prev ?? p),
      zernioPostId: prev?.zernioPostId ?? p.zernioPostId,
      caption: prev?.caption || p.caption,
      thumbnail: prev?.thumbnail ?? p.thumbnail,
      publishedAt: prev?.publishedAt ?? p.publishedAt,
      kind: prev?.kind || p.kind,
      permalink: prev?.permalink ?? p.permalink,
    });
  }
  return [...byPlatformId.values()].sort(
    (a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "") || 0,
  );
}

/** Досинхронизировать пост по ссылке — Zernio ищет ровно её (Reels часто не попадает в фоновый sync). */
export async function syncPostByUrl(
  ctx: TenantContext,
  accountId: string,
  url: string,
): Promise<{ found: boolean; post: PostSummary | null }> {
  if (!ownsZernioAccount(ctx, accountId)) return { found: false, post: null };
  const r = await zernioRequest<{ found?: boolean; post?: RawPost | null }>(
    "/posts/sync-external",
    {
      method: "POST",
      body: { accountId, url },
      timeoutMs: 20_000,
    },
  );
  const post = r.post ? normalizePost(r.post, accountId) : null;
  if (post && !post.zernioPostId) {
    // sync-external знает media id, но не id записи Zernio — добираем из каталога.
    const catalog = await listPosts(ctx, accountId);
    post.zernioPostId =
      catalog.find((p) => p.platformPostId === post.platformPostId)?.zernioPostId ?? null;
  }
  return { found: r.found === true, post };
}

/* ── комментарии и догоняющая рассылка ───────────────────────────────── */

export type AnnotatedComment = InstagramComment & {
  replyStatus: ReturnType<typeof annotateCommentStatus>;
  blockReason: ReturnType<typeof commentPrivateReplyBlockReason>;
};

export async function listPostComments(
  ctx: TenantContext,
  postId: string,
  accountId: string,
  api: AutomationApi = liveAutomationApi,
): Promise<{ comments: AnnotatedComment[]; automation: CommentAutomation | null }> {
  if (!ownsZernioAccount(ctx, accountId)) return { comments: [], automation: null };
  const [comments, automations] = await Promise.all([
    api.comments(postId, accountId),
    listAutomations(ctx, api),
  ]);
  const automation =
    automations.find(
      (a) => a.isActive !== false && a.trigger !== "story_reply" && a.platformPostId === postId,
    ) ?? null;
  const sent = new Set<string>();
  const failed = new Set<string>();
  if (automation) {
    for (const row of await api.logs(automationId(automation), { limit: 200 })) {
      const id = String(row.commentId ?? "");
      if (!id) continue;
      if (row.status === "sent") sent.add(id);
      else if (row.status === "failed") failed.add(id);
    }
  }
  const { data: fallbackSends, error: fallbackErr } = await ctx.db
    .from("comment_dm_fallback_sends")
    .select("comment_id, status")
    .eq("platform_post_id", postId);
  if (fallbackErr)
    throw serverFailure(`[zernio] журнал запасных отправок не прочитан: ${fallbackErr.message}`);
  for (const s of fallbackSends ?? []) {
    if (s.status === "sent") {
      sent.add(s.comment_id);
      failed.delete(s.comment_id);
    } else if (s.status === "failed" && !sent.has(s.comment_id)) {
      failed.add(s.comment_id);
    }
  }
  const now = new Date();
  return {
    automation,
    comments: comments.map((c) => ({
      ...c,
      replyStatus: annotateCommentStatus(c, automation, sent, failed),
      blockReason: commentPrivateReplyBlockReason(c, now),
    })),
  };
}

/** Журнал zernio_logs: строка на comment id, upsert без ON CONFLICT (имя индекса в схеме не наше). */
export async function upsertLog(
  ctx: TenantContext,
  eventId: string,
  row: { event_type: string; status: string; error_message?: string | null; payload: Json },
): Promise<void> {
  const { data, error: readErr3 } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (readErr3) throw serverFailure(`[zernio] журнал не прочитан: ${readErr3.message}`);
  if (data) await ctx.db.from("zernio_logs").update(row).eq("id", data.id);
  else
    await ctx.db.from("zernio_logs").insert({ bot_id: ctx.tenant.id, event_id: eventId, ...row });
}

/* ── двухшаговая DM и кодовые слова (вынесено в подмодуль) ───────────── */
export * from "./automations/types";
export * from "./automations/two-step.server";

import {
  defaultButtons,
  sleep,
  sendSecondStep,
  expressAllowed,
  hasKeywords,
  expressTexts,
  pickCommentReply,
} from "./automations/two-step.server";

/* ── резервный крон ──────────────────────────────────────────────────── */

const MAX_AUTOMATIONS_PER_RUN = 20;
const MAX_SENDS_PER_RUN = 5;
/**
 * Логи правила постранично, пока не дойдём до записей старше окна
 * private-reply или до потолка страниц; вместе с ними — за комментарии
 * какого времени они отвечают (logCoverage).
 */
async function readAutomationLogs(
  api: AutomationApi,
  automationId: string,
  now: Date,
): Promise<{ logs: AutomationLog[]; coverage: LogCoverage | null }> {
  const logs: AutomationLog[] = [];
  const cutoff = now.getTime() - FALLBACK_MAX_AGE_MS;
  for (let page = 0; page < LOG_MAX_PAGES; page++) {
    const rows = await api.logs(automationId, { limit: LOG_PAGE_SIZE, skip: page * LOG_PAGE_SIZE });
    logs.push(...rows);
    if (rows.length < LOG_PAGE_SIZE) return { logs, coverage: logCoverage(logs, true) };
    if (logsReachBack(rows, cutoff)) break;
  }
  return { logs, coverage: logCoverage(logs, false) };
}

export type FallbackResult = {
  automationsChecked: number;
  commentsChecked: number;
  sent: number;
  failed: number;
  /** Zernio ответил 429: остальные правила не трогали, пробуем снова через столько секунд. */
  rateLimitedSec?: number;
  /** Бюджет времени кончился: правил, отложенных на следующий запуск. */
  deferred?: number;
};

/** Откуда начать обход правил: id правила, до которого не дошли в прошлый раз (app_settings, маленькое поле). */
const FALLBACK_CURSOR_KEY = "comment_dm_fallback_cursor";

/**
 * Резерв в существующий диалог покупателя — обычной отправкой, один раз.
 * Повтора с тегом HUMAN_AGENT нет: Meta разрешает этот тег только для
 * ответа живого сотрудника, автоответ с ним — риск блокировки аккаунта
 * (сверка с документацией Zernio, п. 12). Окно закрыто — отказ остаётся
 * отказом, дальше публичная просьба написать первым.
 */
export async function sendAltChannel(
  api: Pick<AutomationApi, "inbox">,
  conversationId: string,
  automation: { accountId: string; dmMessage: string; buttons?: AutomationButton[] },
): Promise<{ status: "sent" | "failed"; error: string | null }> {
  const r = await api.inbox(conversationId, automation.accountId, automation.dmMessage, {
    buttons: automation.buttons ?? [],
    platform: "instagram",
  });
  return r.ok
    ? { status: "sent", error: null }
    : { status: "failed", error: (r.error ?? "").slice(0, 500) };
}

/**
 * Резервная DM по комментарию — на случай, если родное Comment-to-DM Zernio
 * молча замолкло на конкретном посте (живой инцидент: сотня клиентов без
 * ответа несколько дней). Раз в 15 минут сверяем комментарии per-post
 * правил с логами срабатываний: подходит под слова, но не «sent» — шлём
 * тем же private-reply. Не прошёл — эскалация: inbox в существующий диалог
 * (обычной отправкой, без тега — см. sendAltChannel), публичный ответ только если
 * DM реально ушла, иначе — публичная просьба написать первым (если задана).
 * Строка comment_dm_fallback_sends резервируется ДО отправки: уникальность
 * (automation_id, comment_id) — единственная защита от повтора при гонке.
 */
/** Свежесть правила: время создания по ISO createdAt либо по временной метке в ObjectId (Zernio). */
export function automationFreshness(a: CommentAutomation): number {
  if (a.createdAt) {
    const t = Date.parse(a.createdAt);
    if (!Number.isNaN(t)) return t;
  }
  const id = automationId(a);
  if (/^[0-9a-f]{24}$/i.test(id)) {
    return parseInt(id.slice(0, 8), 16) * 1000;
  }
  return 0;
}

export async function runCommentDmFallback(
  ctx: TenantContext,
  api: AutomationApi = liveAutomationApi,
  now = new Date(),
  /** Бюджет времени крона: правила, до которых не дошли, ждут следующего запуска (по кругу). */
  spent: () => boolean = () => false,
): Promise<FallbackResult> {
  const result: FallbackResult = { automationsChecked: 0, commentsChecked: 0, sent: 0, failed: 0 };
  if (!ctx.tenant.modules.instagram) return result;
  let all: CommentAutomation[];
  try {
    all = await listAutomations(ctx, api);
  } catch (e) {
    const limited = rateLimitOf(e);
    if (limited === null) throw e;
    return { ...result, rateLimitedSec: limited };
  }
  // Берём до 20 самых свежих правил: жалобы и новые комментарии идут по свежим публикациям,
  // а старые правила не задерживают проверку новых.
  const active = all
    .filter((a) => a.isActive !== false && a.trigger !== "story_reply" && a.platformPostId)
    .filter((a) => automationId(a))
    .sort((a, b) => {
      const diff = automationFreshness(b) - automationFreshness(a);
      if (diff !== 0) return diff;
      return automationId(a).localeCompare(automationId(b));
    })
    .slice(0, MAX_AUTOMATIONS_PER_RUN);

  // Обход по кругу с места, где остановились (если бюджет прервал прошлый запуск).
  const cursor = await getSetting(ctx, FALLBACK_CURSOR_KEY);
  const start = cursor ? active.findIndex((a) => automationId(a) === cursor) : 0;
  const perPost = start > 0 ? [...active.slice(start), ...active.slice(0, start)] : active;
  let sendsThisRun = 0;
  const saveCursor = async (next: string) => {
    if ((cursor ?? "") === next) return;
    try {
      await setSetting(ctx, FALLBACK_CURSOR_KEY, next);
    } catch (e) {
      console.error(
        `[comment-dm-fallback] курсор не сохранён: ${e instanceof Error ? e.message : e}`,
      );
    }
  };

  for (const [i, automation] of perPost.entries()) {
    const autoId = automationId(automation);
    const postId = automation.platformPostId!;
    if (i >= MAX_AUTOMATIONS_PER_RUN || spent()) {
      result.deferred = perPost.length - i;
      await saveCursor(autoId);
      return result;
    }
    result.automationsChecked++;
    const nextId = automationId(perPost[(i + 1) % perPost.length]!);
    try {
      // Ошибка чтения логов — исключение и пропуск правила: без логов любой
      // комментарий выглядит пропущенным, а это повтор всем, кто уже получил.
      const [comments, { logs, coverage }] = await Promise.all([
        api.comments(postId, automation.accountId, spent),
        readAutomationLogs(api, autoId, now),
      ]);
      const handledByZernio = commentIdsHandledByZernio(logs);
      // Кому по этому посту уже писали — Zernio или этот проход.
      const writtenCommenters = commenterIdsOf(comments, handledByZernio);
      const sentByZernio = new Set(
        logs.filter((r) => r.status === "sent").map((r) => String(r.commentId ?? "")),
      );
      const publicByZernio = new Set(
        logs.filter((r) => r.commentReplyStatus === "sent").map((r) => String(r.commentId ?? "")),
      );
      // Уже записанные запасные отправки по правилу — одним чтением. Без него
      // каждый прогон пытался заново вставить строку на каждый подходящий
      // комментарий за 6,5 суток и ловил 409 от уникального ключа: ~5 000
      // ошибок в журнале Postgres в сутки. Вставка ниже остаётся защитой от гонки.
      const knownSends = new Map(
        (
          await inChunks(
            comments.map((c) => c.id).filter((id): id is string => Boolean(id)),
            (chunk) =>
              ctx.db
                .from("comment_dm_fallback_sends")
                .select("comment_id, status, created_at, updated_at")
                .eq("automation_id", autoId)
                .in("comment_id", chunk),
            "[zernio] запасные отправки не прочитаны",
          )
        ).map((r) => [r.comment_id, r] as const),
      );
      for (const comment of comments) {
        const commentId = comment.id;
        if (!commentId || comment.from?.isOwner) continue;
        result.commentsChecked++;
        const twoStep = Boolean(automation.twoStepDm) || Boolean(automation.buttons?.length);
        if (sentByZernio.has(commentId)) {
          if (!twoStep) continue;
          // Первое ушло родным Zernio — проверяем второе.
          const { data: log, error: logErr } = await ctx.db
            .from("zernio_logs")
            .select("status")
            .eq("event_id", `two-step-dm:${commentId}`)
            .maybeSingle();
          if (logErr) {
            console.error(
              `[zernio] журнал второго сообщения не прочитан, комментарий пропущен до следующего запуска: ${logErr.message}`,
            );
            continue;
          }
          if (log) continue; // ушло или уже ждёт в очереди
          const username = comment.from?.username;
          if (!username) continue;
          if (
            await sendSecondStep(
              ctx,
              {
                accountId: automation.accountId,
                automationId: autoId,
                commentId,
                username,
                authorId: comment.from?.id ?? null,
                noExpress: !expressAllowed(
                  comment.message ?? "",
                  automation,
                  hasKeywords(automation)
                    ? []
                    : await expressTexts(
                        ctx,
                        automation.secondDmButtons?.length
                          ? automation.secondDmButtons
                          : (automation.buttons ?? []),
                        automation.postTitle,
                      ),
                ),
                secondText: automation.secondDmMessage || DEFAULT_SECOND_DM,
                buttons: automation.secondDmButtons?.length
                  ? automation.secondDmButtons
                  : automation.buttons?.length
                    ? automation.buttons
                    : defaultButtons(ctx),
              },
              api,
            )
          )
            result.sent++;
          continue;
        }
        if (handledByZernio.has(commentId)) continue; // skipped: Zernio видел и сознательно не писал
        if (
          !commentMatchesAutomation(
            comment.message ?? "",
            automation.keywords,
            automation.matchMode,
          )
        )
          continue;
        if (commentAgeVerdict(comment.createdTime ?? "", now) !== "eligible") continue;
        if (commentPrivateReplyBlockReason(comment, now)) continue;
        // Комментарий старше прочитанных логов: был ли он обработан — не знаем.
        if (!commentCoveredByLogs(comment.createdTime ?? "", coverage)) continue;
        if (sendsThisRun >= MAX_SENDS_PER_RUN) continue;

        // Второй комментарий того же автора к посту не догоняем.
        const authorId = comment.from?.id;
        if (authorId && writtenCommenters.has(authorId)) continue;
        if (authorId) {
          const siblingIds = comments
            .filter((c) => c.id && c.id !== commentId && c.from?.id === authorId)
            .map((c) => c.id as string);
          if (siblingIds.length > 0) {
            const { data: earlier, error: earlierErr } = await ctx.db
              .from("comment_dm_fallback_sends")
              .select("comment_id")
              .eq("automation_id", autoId)
              .in("comment_id", siblingIds)
              .in("status", ["sent", "pending"])
              .limit(1);
            if (earlierErr) {
              console.error(
                `[zernio] прежние отправки не прочитаны, комментарий пропущен: ${earlierErr.message}`,
              );
              continue;
            }
            if (earlier?.length) {
              writtenCommenters.add(authorId);
              continue;
            }
          }
        }

        const known = knownSends.get(commentId);
        // Строка уже есть и не зависла — вставлять заново незачем (только 409).
        if (known && ["wait", "skip"].includes(stalePendingAction(known, now))) continue;
        const { error: reserveError } = known
          ? { error: { message: "already reserved" } }
          : await ctx.db.from("comment_dm_fallback_sends").insert({
              bot_id: ctx.tenant.id,
              automation_id: autoId,
              platform_post_id: postId,
              comment_id: commentId,
              status: "pending",
            });
        let allowAltChannel = true;
        if (reserveError) {
          const { data: existing, error: existingErr } = await ctx.db
            .from("comment_dm_fallback_sends")
            .select("status, created_at, updated_at")
            .eq("automation_id", autoId)
            .eq("comment_id", commentId)
            .maybeSingle();
          if (existingErr) {
            console.error(
              `[zernio] запасная отправка не прочитана, комментарий пропущен: ${existingErr.message}`,
            );
            continue;
          }
          const action = existing ? stalePendingAction(existing, now) : "wait";
          if (action === "wait" || action === "skip") continue;
          if (action === "abandon") {
            await ctx.db
              .from("comment_dm_fallback_sends")
              .update({
                status: "failed",
                error:
                  "stale pending: повтор в директ не шлём — прошлый прогон мог уже доставить сообщение",
                updated_at: now.toISOString(),
              })
              .eq("automation_id", autoId)
              .eq("comment_id", commentId)
              .eq("status", "pending");
            continue;
          }
          const { data: takeover, error: takeoverErr } = await ctx.db
            .from("comment_dm_fallback_sends")
            .update({ updated_at: now.toISOString() })
            .eq("automation_id", autoId)
            .eq("comment_id", commentId)
            .eq("status", "pending")
            .lt("updated_at", new Date(now.getTime() - STALE_PENDING_MS).toISOString())
            .select("id");
          if (takeoverErr)
            console.error(`[zernio] зависшая отправка не перехвачена: ${takeoverErr.message}`);
          if (!takeover?.length) continue;
          allowAltChannel = false;
        }

        sendsThisRun++;
        if (authorId) writtenCommenters.add(authorId);
        const reply = await api.privateReply(
          postId,
          commentId,
          automation.accountId,
          automation.firstMessage ?? automation.dmMessage,
          // Первое — только текст (как в догоняющей рассылке): кнопки — вторым сообщением.
          [],
        );
        if (reply.rateLimitedSec !== undefined) {
          // 429: Zernio сообщение не принял. Бронь снимаем, чтобы комментарий попал в следующий запуск,
          // и дальше не стучимся: лимит общий на ключ.
          const { error: freeErr } = await ctx.db
            .from("comment_dm_fallback_sends")
            .delete()
            .eq("automation_id", autoId)
            .eq("comment_id", commentId)
            .eq("status", "pending");
          if (freeErr) console.error(`[zernio] бронь после 429 не снята: ${freeErr.message}`);
          await saveCursor(autoId);
          return { ...result, rateLimitedSec: reply.rateLimitedSec, deferred: perPost.length - i };
        }
        if (reply.ok) {
          result.sent++;
          const username = comment.from?.username;
          if (twoStep && username) {
            await sleep(1500);
            await sendSecondStep(
              ctx,
              {
                accountId: automation.accountId,
                automationId: autoId,
                commentId,
                username,
                authorId: comment.from?.id ?? null,
                noExpress: !expressAllowed(
                  comment.message ?? "",
                  automation,
                  hasKeywords(automation)
                    ? []
                    : await expressTexts(
                        ctx,
                        automation.secondDmButtons?.length
                          ? automation.secondDmButtons
                          : (automation.buttons ?? []),
                        automation.postTitle,
                      ),
                ),
                secondText: automation.secondDmMessage || DEFAULT_SECOND_DM,
                buttons: automation.secondDmButtons?.length
                  ? automation.secondDmButtons
                  : automation.buttons?.length
                    ? automation.buttons
                    : defaultButtons(ctx),
              },
              api,
            );
          }
        }
        // Meta: на этот комментарий уже отвечали — человек своё сообщение
        // получил. Альт-канал прислал бы ему то же самое второй раз.
        const alreadyReplied = !reply.ok && isPrivateReplyAlreadySent(reply.error ?? "");
        if (!reply.ok && !alreadyReplied) result.failed++;

        let altStatus: "skipped" | "sent" | "failed" = "skipped";
        let altError: string | null = null;
        if (!reply.ok && allowAltChannel && !alreadyReplied && comment.from?.id) {
          const { data: buyer, error: buyerErr } = await ctx.db
            .from("bot_users")
            .select("zernio_conversation_id")
            .eq("user_key", `ig_${comment.from.id}`)
            .maybeSingle();
          if (buyerErr)
            console.error(
              `[zernio] переписка для запасного канала не прочитана: ${buyerErr.message}`,
            );
          if (buyer?.zernio_conversation_id) {
            const alt = await sendAltChannel(api, buyer.zernio_conversation_id, automation);
            altStatus = alt.status;
            altError = alt.error;
          }
        }

        // Публичный ответ — только если DM реально ушла; иначе публичная
        // просьба написать первым. Колонок под просьбу (MIGRATION-66 v1) в
        // живой базе нет, а comment_reply_status ограничен check-constraint
        // (sent/failed/skipped) — итог просьбы пишем в comment_reply_error
        // с префиксом prompt_.
        let publicStatus: "skipped" | "sent" | "failed" = "skipped";
        let publicError: string | null = null;
        const commentReply = pickCommentReply(automation);
        const prompt = automation.unresolvedPrompt?.trim();
        if ((reply.ok || altStatus === "sent") && commentReply && !publicByZernio.has(commentId)) {
          const r = await api.publicReply(postId, commentId, automation.accountId, commentReply);
          publicStatus = r.ok ? "sent" : "failed";
          publicError = r.ok ? null : (r.error?.slice(0, 500) ?? null);
        } else if (
          !reply.ok &&
          !alreadyReplied &&
          altStatus !== "sent" &&
          allowAltChannel &&
          prompt
        ) {
          const r = await api.publicReply(postId, commentId, automation.accountId, prompt);
          publicError = r.ok ? "prompt_sent" : `prompt_failed: ${r.error ?? ""}`.slice(0, 500);
        }

        const { error: finishError } = await ctx.db
          .from("comment_dm_fallback_sends")
          .update({
            status: fallbackRecordStatus(reply.ok || alreadyReplied, altStatus),
            error: reply.error?.slice(0, 500) ?? null,
            alt_channel_status: altStatus,
            alt_channel_error: altError,
            comment_reply_status: publicStatus,
            comment_reply_error: publicError,
            updated_at: new Date().toISOString(),
          })
          .eq("automation_id", autoId)
          .eq("comment_id", commentId);
        if (finishError) throw new Error(`comment_dm_fallback_sends: ${finishError.message}`);
      }
    } catch (e) {
      const limited = rateLimitOf(e);
      if (limited !== null) {
        // Лимит Zernio на весь ключ: остальные запросы только углубят его. Это же правило — первым в следующий раз.
        await saveCursor(autoId);
        return { ...result, rateLimitedSec: limited, deferred: perPost.length - i };
      }
      if (e instanceof CommentsStopped) {
        // Список комментариев большой и не уложился: правило пропускаем, остальным даём очередь.
        await saveCursor(nextId);
        result.deferred = perPost.length - i;
        return result;
      }
      console.error(
        `[comment-dm-fallback] ${ctx.tenant.id} правило ${autoId}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  await saveCursor("");
  return result;
}

/** Секунды ожидания, если это 429 / лимит Zernio (Retry-After, иначе 60); иначе null. */
function rateLimitOf(e: unknown): number | null {
  if (!(e instanceof ZernioApiError)) return null;
  // Только лимит на весь ключ (429): лимит одного получателя (131056) остальным не мешает.
  if (e.failure.status !== 429 || classifyZernioFailure(e.failure) !== "rate_limited") return null;
  return e.failure.retryAfterSec ?? 60;
}

export async function listFallbackSends(ctx: TenantContext, limit = 50) {
  const { data, error: readErr } = await ctx.db
    .from("comment_dm_fallback_sends")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (readErr)
    throw serverFailure(`[zernio] журнал запасных отправок не прочитан: ${readErr.message}`);
  return data ?? [];
}
