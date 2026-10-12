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
import { COPY } from "@/channels/telegram/copy";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import { secondStepAsText, secondStepFailureText, textFallbackAllowed } from "./second-step-text";
import { getSetting, setSetting } from "@/core/settings/settings";
import {
  DEFAULT_REPLY_PROMPT,
  DEFAULT_SECOND_DM,
  DM_LIMIT_PLAIN,
  LEGACY_REPLY_PROMPTS,
  REQUESTS_HINT,
  commentLang,
  isNotReceivedComment,
  replyPromptsOf,
  STALE_PENDING_MS,
  annotateCommentStatus,
  buildAutomationBody,
  commentAgeVerdict,
  commentMatchesAutomation,
  commentOnRulePost,
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
import { ZernioApiError, classifyZernioFailure, type ZernioFailure } from "./errors";
import { serverFailure } from "@/lib/server-failure";
import { fill, type UserErrorVars } from "@/core/i18n/user-error";
import { pageAll } from "@/core/db/page";
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

function defaultButtons(ctx: TenantContext): AutomationButton[] {
  const u = ctx.tenant.settings.telegram?.username;
  // Язык комментатора неизвестен, поэтому — язык магазина.
  const title = COPY[ctx.tenant.settings.default_locale ?? "ru"].openTelegramBtn;
  return u ? [{ type: "url", title, url: `https://t.me/${u}` }] : [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Журнал zernio_logs: строка на comment id, upsert без ON CONFLICT (имя индекса в схеме не наше). */
async function upsertLog(
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

/**
 * Второе сообщение двухшаговой DM (с кнопками) — в Direct, если диалог с
 * покупателем уже есть. Написать первым в Instagram нельзя: Zernio «создать
 * диалог» для Instagram не поддерживает, единственный путь к незнакомому —
 * private-reply на комментарий (первое сообщение). Поэтому без диалога — в
 * очередь pending: второе уйдёт первым же ответом покупателя
 * (deliverPendingTwoStepDm).
 */
async function sendSecondStep(
  ctx: TenantContext,
  p: {
    accountId: string;
    automationId: string;
    commentId: string;
    username: string;
    /** id автора комментария: по нему узнаём покупателя, если Zernio прислал в Direct вместо имени цифры. */
    authorId?: string | null;
    secondText: string;
    buttons: AutomationButton[];
    /** Комментарий не называет товар правила — без быстрой покупки (expressAllowed). */
    noExpress?: boolean;
  },
  api: AutomationApi,
): Promise<boolean> {
  const key = `two-step-dm:${p.commentId}`;
  const buttons = normalizeDmButtons(p.buttons as DmButton[]);
  const { data: known, error: knownErr } = await ctx.db
    .from("bot_users")
    .select("zernio_conversation_id")
    .eq("platform", "instagram")
    .ilike("username", p.username)
    .maybeSingle();
  if (knownErr) console.error(`[zernio] переписка покупателя не прочитана: ${knownErr.message}`);
  let ok = false;
  let error: string | undefined = "ждём ответа покупателя в Direct";
  let failure: ZernioFailure | undefined;
  // Выбор текстом уже уходил (повтор вебхука, крон) — второй раз не шлём.
  const { data: before, error: beforeErr } = await ctx.db
    .from("zernio_logs")
    .select("payload")
    .eq("event_id", key)
    .maybeSingle();
  if (beforeErr)
    console.error(`[zernio] журнал второго сообщения не прочитан: ${beforeErr.message}`);
  const textSentBefore = (before?.payload as { textSentAt?: string } | null)?.textSentAt;
  let textSentAt: string | undefined = textSentBefore;
  if (known?.zernio_conversation_id) {
    const claim = await claimConversationSecondStep(ctx, known.zernio_conversation_id, key);
    if (claim.result === "taken") {
      // Второе этому покупателю уже ушло другим путём («+» раньше вебхука,
      // другое правило на тот же пост) — второй раз не шлём.
      await upsertLog(ctx, key, {
        event_type: "two_step_dm_sent",
        status: "processed",
        error_message: ALREADY_SENT,
        payload: { commentId: p.commentId, username: p.username, automationId: p.automationId },
      });
      return true;
    }
    if (claim.result === "won") {
      const r = await api.inbox(known.zernio_conversation_id, p.accountId, p.secondText, {
        buttons,
        platform: "instagram",
      });
      ok = r.ok;
      error = r.error;
      if (!ok) {
        await claim.release();
        // Старая переписка: Instagram отказал. Не «проверьте подключение», а
        // что было, и тот же выбор текстом — только после точного отказа.
        failure = r.failure;
        let text: "sent" | "failed" | "skipped" = textSentBefore ? "sent" : "skipped";
        if (!textSentBefore && !beforeErr && textFallbackAllowed(r.failure)) {
          const locale = ctx.tenant.settings.default_locale ?? "ru";
          const t = await api.inbox(
            known.zernio_conversation_id,
            p.accountId,
            secondStepAsText(locale, p.secondText, buttons),
            { platform: "instagram", idempotencyScope: `${key}:text` },
          );
          text = t.ok ? "sent" : "failed";
          if (t.ok) textSentAt = new Date().toISOString();
        }
        error = secondStepFailureText(r.failure, text);
      }
    }
  }
  await upsertLog(ctx, key, {
    event_type: ok ? "two_step_dm_sent" : "two_step_dm_pending",
    status: ok ? "processed" : "pending",
    error_message: ok ? null : (error ?? null),
    payload: {
      commentId: p.commentId,
      username: p.username,
      ...(p.authorId ? { authorId: p.authorId } : {}),
      accountId: p.accountId,
      automationId: p.automationId,
      secondText: p.secondText,
      buttons: toJson(buttons),
      ...(p.noExpress ? { noExpress: true } : {}),
      ...(textSentAt ? { textSentAt } : {}),
      ...(failure ? { failure: toJson(failure) } : {}),
      createdAt: new Date().toISOString(),
    },
  });
  if (ok)
    await supersedeOlderTwoStep(
      ctx,
      { username: p.username, senderId: p.authorId },
      { eventId: key },
    );
  return ok;
}

export type CommentReceivedPayload = {
  account?: { accountId?: string; id?: string; _id?: string; username?: string };
  post?: { platformPostId?: string; id?: string; content?: string };
  comment?: {
    id?: string;
    text?: string;
    postId?: string;
    platformPostId?: string;
    author?: { id?: string; username?: string };
  };
};

/**
 * comment.received: первое сообщение (текст без кнопок) шлёт Zernio своим
 * правилом; здесь — второе с кнопками для правил в двухшаговом режиме.
 */
export async function handleCommentReceived(
  ctx: TenantContext,
  payload: CommentReceivedPayload,
  api: AutomationApi = liveAutomationApi,
  opts: { delayMs?: number } = {},
): Promise<{ note: string }> {
  const accountId = payload.account?.accountId || payload.account?.id || payload.account?._id;
  const username = payload.comment?.author?.username;
  const commentId = payload.comment?.id;
  if (!accountId || !username || !commentId) return { note: "нет accountId/username/commentId" };
  if (
    payload.comment?.author?.id === payload.account?.id ||
    (payload.account?.username && username.toLowerCase() === payload.account.username.toLowerCase())
  )
    return { note: "комментарий самого аккаунта" };
  const text = payload.comment?.text?.trim().toLowerCase() ?? "";
  const hint = await answerNotReceived(ctx, payload, { accountId, username, commentId, text }, api);
  if (hint) return { note: hint };
  const commentPostId =
    payload.comment?.platformPostId ||
    payload.post?.platformPostId ||
    payload.comment?.postId ||
    payload.post?.id ||
    "";

  // «Или есть кнопки» — как в кроне: если мету при приведении старого правила
  // записать не удалось, кнопки остались у Zernio, и правило всё равно двухшаговое.
  const automations = (await listAutomations(ctx, api)).filter(
    (a) =>
      (a.twoStepDm || Boolean(a.buttons?.length)) &&
      a.isActive !== false &&
      a.accountId === accountId,
  );
  if (automations.length === 0) return { note: "двухшаговых правил нет" };
  const caption = payload.post?.content;
  const matched = automations.find((a) => {
    const own = commentOnRulePost(a, commentPostId, caption);
    if (own === false) return false;
    if (!commentMatchesAutomation(text, a.keywords, a.matchMode)) return false;
    // Пост не узнать (нет подписи в событии), а правило «любой комментарий» —
    // только если комментарий называет товар правила («Палитра», «Политра»).
    return own === true || expressAllowed(text, a);
  });
  if (!matched) return { note: "правило не совпало" };

  const { data: existing, error: existingErr2 } = await ctx.db
    .from("zernio_logs")
    .select("status")
    .eq("event_id", `two-step-dm:${commentId}`)
    .maybeSingle();
  if (existingErr2)
    throw serverFailure(`[zernio] журнал второго сообщения не прочитан: ${existingErr2.message}`);
  if (existing?.status === "processed") return { note: "второе сообщение уже ушло" };
  if (existing?.status === "skipped") return { note: "второе сообщение уже закрыто" };

  // Второй комментарий того же человека по тому же правилу за сутки: первое
  // сообщение Zernio не повторит (repeatPolicy), и второе в очередь не ставим —
  // одно на человека (решение Якова 11.10, 7; vertsanova.svetlana, Копилка).
  const since = new Date(Date.now() - REPEAT_COOLDOWN_HOURS * 3_600_000).toISOString();
  const { data: sameRule, error: sameErr } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .in("event_type", TWO_STEP_TYPES)
    // «_» в имени Instagram — подстановочный знак LIKE: экранируем.
    .ilike("payload->>username", username.replace(/[\\%_]/g, "\\$&"))
    .eq("payload->>automationId", automationId(matched))
    .gte("created_at", since)
    .neq("event_id", `two-step-dm:${commentId}`)
    .order("id")
    .limit(1);
  if (sameErr)
    throw serverFailure(`[zernio] журнал второго сообщения не прочитан: ${sameErr.message}`);
  if (sameRule?.length) return { note: `повторный комментарий @${username} — сообщение уже было` };

  // Пауза: даём Zernio и Meta доставить первое сообщение без кнопок.
  await sleep(opts.delayMs ?? 1500);
  const buttons = matched.secondDmButtons?.length
    ? matched.secondDmButtons
    : matched.buttons?.length
      ? matched.buttons
      : defaultButtons(ctx);
  const ok = await sendSecondStep(
    ctx,
    {
      accountId,
      automationId: automationId(matched),
      commentId,
      username,
      authorId: payload.comment?.author?.id ?? null,
      secondText: matched.secondDmMessage || DEFAULT_SECOND_DM,
      buttons,
      noExpress: !expressAllowed(
        text,
        matched,
        hasKeywords(matched) ? [] : await expressTexts(ctx, buttons, payload.post?.content),
      ),
    },
    api,
  );
  return { note: ok ? `второе сообщение @${username}` : `в очередь pending @${username}` };
}

/**
 * Активное правило Zernio этого аккаунта сработает на комментарий: первое
 * личное сообщение по нему шлёт Zernio, а Instagram разрешает на комментарий
 * только одно — консультант тогда не отвечает (comment-consultant.server).
 */
export async function zernioRuleCoversComment(
  ctx: TenantContext,
  p: { accountId: string; text: string; postId: string; caption?: string | null },
  api: AutomationApi = liveAutomationApi,
): Promise<boolean> {
  const text = p.text.trim().toLowerCase();
  const rules = (await listAutomations(ctx, api)).filter(
    (a) => a.isActive !== false && a.accountId === p.accountId,
  );
  return rules.some(
    (a) =>
      commentOnRulePost(a, p.postId, p.caption ?? undefined) !== false &&
      commentMatchesAutomation(text, a.keywords, a.matchMode),
  );
}

/** Сколько после первого сообщения «ничего нет» под постом получает подсказку про «Запросы». */
export const NOT_RECEIVED_WINDOW_MS = 24 * 60 * 60_000;

/**
 * «Ничего нет / не пришло» от того, кому за последние сутки уже ушло первое
 * сообщение правила: отвечаем публично под этим комментарием, где искать
 * («Запросы»), и второе сообщение по нему не ставим — первое у покупателя
 * уже есть. Один раз на комментарий: отметку ставит вставка с уникальным
 * ключом, шлёт только выигравший; отправку, которая могла дойти, не
 * повторяем. Private-reply на этот комментарий Zernio шлёт сам по правилу —
 * его мы не отменяем. Только клиенты v2.
 */
async function answerNotReceived(
  ctx: TenantContext,
  payload: CommentReceivedPayload,
  c: { accountId: string; username: string; commentId: string; text: string },
  api: AutomationApi,
  now: () => Date = () => new Date(),
): Promise<string | null> {
  if (!servedByV2(ctx.tenant) || !isNotReceivedComment(c.text)) return null;
  const postId = payload.comment?.platformPostId || payload.post?.platformPostId;
  if (!postId) return null;
  const since = new Date(now().getTime() - NOT_RECEIVED_WINDOW_MS).toISOString();
  const { data: earlier, error: readErr } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .in("event_type", TWO_STEP_TYPES)
    // «_» в имени Instagram — подстановочный знак LIKE: экранируем.
    .ilike("payload->>username", c.username.replace(/[\\%_]/g, "\\$&"))
    .gte("created_at", since)
    .neq("event_id", `two-step-dm:${c.commentId}`)
    .order("id")
    .limit(1);
  if (readErr)
    throw serverFailure(`[zernio] журнал первого сообщения не прочитан: ${readErr.message}`);
  if (!earlier?.length) return null;

  const key = `requests-hint:${c.commentId}`;
  const message = REQUESTS_HINT[commentLang(payload.comment?.text ?? "")];
  const { error: claimErr } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: key,
    event_type: "comment.requests_hint",
    status: "pending",
    error_message: null,
    payload: { commentId: c.commentId, username: c.username, postId, message },
  });
  if (claimErr) {
    if (/duplicate|unique/i.test(claimErr.message)) return "подсказка про «Запросы» уже ушла";
    throw serverFailure(`[zernio] отметка подсказки не записана: ${claimErr.message}`);
  }
  const r = await api.publicReply(postId, c.commentId, c.accountId, message);
  const { error: doneErr } = await ctx.db
    .from("zernio_logs")
    .update({
      status: r.ok ? "processed" : "failed",
      error_message: r.ok ? null : (r.error?.slice(0, 500) ?? null),
    })
    .eq("bot_id", ctx.tenant.id)
    .eq("event_id", key);
  if (doneErr) console.warn(`[zernio] итог подсказки не записан: ${doneErr.message}`);
  return r.ok
    ? `подсказка про «Запросы» @${c.username}`
    : `подсказка про «Запросы» не ушла @${c.username}`;
}

const PENDING_TWO_STEP_DAYS = 7;
/**
 * Сколько обещанное второе сообщение ждёт ответа покупателя. Дольше — не
 * шлём: покупатель уже забыл, под чем писал, а «Купить» старого видео посреди
 * новой переписки сбивает (AATeach 10.10: «через день, если не ответили,
 * пусть перестаёт работать»).
 */
export const PENDING_TWO_STEP_MS = 24 * 60 * 60_000;
/** Строка очереди, которую сменил комментарий новее или ушедшее второе сообщение. */
export const SUPERSEDED = "покупатель написал под другим видео — работает последнее";
/** Строка очереди, правило которой продавец удалил или выключил. */
export const RULE_GONE = "правило удалено или выключено";

/** Своя строка очереди: по имени или по id автора комментария. */
function ownTwoStepRow(pl: Json, who: { username?: string | null; senderId?: string | null }) {
  const p = pl as { username?: string; authorId?: string } | null;
  const name = who.username?.toLowerCase();
  return (
    (Boolean(name) && typeof p?.username === "string" && p.username.toLowerCase() === name) ||
    (Boolean(who.senderId) && p?.authorId === who.senderId)
  );
}

/**
 * Работает только последнее видео: прежние обещанные вторые сообщения этого
 * покупателя закрываются, когда ушло (или забрано к отправке) новое. Закрытие
 * — условной записью по статусу pending: строку, которую в этот момент
 * забрал соседний вебхук, не трогаем.
 */
async function supersedeOlderTwoStep(
  ctx: TenantContext,
  who: { username?: string | null; senderId?: string | null },
  keep: { id?: string; eventId?: string },
  now: () => Date = () => new Date(),
): Promise<void> {
  const since = new Date(now().getTime() - PENDING_TWO_STEP_MS).toISOString();
  let rows: { id: string; event_id: string | null; payload: Json }[];
  try {
    rows = await pageAll(
      (from, to) =>
        ctx.db
          .from("zernio_logs")
          .select("id, event_id, payload")
          .eq("event_type", "two_step_dm_pending")
          .eq("status", "pending")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      "[zernio] очередь вторых сообщений не прочитана",
    );
  } catch (e) {
    console.warn(`[comment-dm] прежние вторые сообщения не закрыты: ${String(e)}`);
    return;
  }
  const older = rows
    .filter((r) => r.id !== keep.id && r.event_id !== keep.eventId)
    .filter((r) => ownTwoStepRow(r.payload, who))
    .map((r) => r.id);
  for (let i = 0; i < older.length; i += 200) {
    const { error } = await ctx.db
      .from("zernio_logs")
      .update({ status: "skipped", error_message: SUPERSEDED })
      .in("id", older.slice(i, i + 200))
      .eq("status", "pending");
    if (error) console.warn(`[comment-dm] прежние вторые сообщения не закрыты: ${error.message}`);
  }
}
/** Захват старше этого — процесс, скорее всего, умер до отправки (таймаут функции). */
export const TWO_STEP_CLAIM_STALE_MS = 5 * 60 * 1000;
/** Сколько раз забираем строку второго шага, прежде чем сдаться. */
export const TWO_STEP_MAX_ATTEMPTS = 3;

/**
 * Метка захвата в error_message: время и номер попытки. Условие «метка та же»
 * в записи — защита от двух одновременных перехватов зависшей строки.
 */
const claimToken = (at: Date, attempt: number) => `claim:${at.toISOString()}:${attempt}`;
function parseClaim(token: string | null): { at: number; attempt: number } | null {
  const m = /^claim:(.+):(\d+)$/.exec(token ?? "");
  if (!m) return null;
  const at = Date.parse(m[1]!);
  return Number.isFinite(at) ? { at, attempt: Number(m[2]) } : null;
}

type PendingRow = {
  id: string;
  status: string;
  error_message: string | null;
  payload: Json;
};

/**
 * Зависший захват (процесс умер между захватом и отметкой): ушло ли второе
 * сообщение, смотрим по хвосту переписки — исходящее с тем же текстом после
 * захвата. Ушло — отмечаем отправленным, повторно не шлём. Хвост не
 * прочитался или пуст — не знаем (как findSent в outbox), поэтому не шлём и
 * ждём следующего ответа покупателя.
 */
async function alreadyDelivered(
  api: AutomationApi,
  p: { accountId: string; conversationId: string },
  text: string,
  since: number,
): Promise<boolean | null> {
  try {
    const tail = await api.tail(p.accountId, p.conversationId);
    // Пустой хвост — Zernio переписку не отдал: неизвестно, а не «не ушло».
    if (tail.length === 0) return null;
    return tail.some(
      (m) =>
        m.direction === "outgoing" &&
        (m.message ?? "").trim() === text.trim() &&
        Date.parse(m.createdAt ?? "") >= since - 60_000,
    );
  } catch {
    return null;
  }
}

/** Кто ждёт второе сообщение. `express` — быстрая покупка магазина (handle-message). */
export type TwoStepBuyer = {
  accountId: string;
  conversationId: string;
  username: string;
  senderId?: string;
  /**
   * Быстрая покупка: у правила кнопка «Купить» (PROD:<id>) — вместо второго
   * сообщения магазин сразу оформляет заказ на этот товар. false — ничего не
   * отправлено, уходит обычное второе сообщение.
   */
  express?: (productId: string) => Promise<boolean>;
};

/**
 * Тексты, которыми покупатель может назвать товар правила, кроме самого
 * правила: название товара кнопки «Купить» и подпись поста. Не прочиталось —
 * пусто: быстрой покупки не будет, уйдёт обычное второе сообщение.
 */
async function expressTexts(
  ctx: TenantContext,
  buttons: AutomationButton[],
  caption?: string | null,
): Promise<string[]> {
  const id = buyButtonProduct(normalizeDmButtons(buttons as DmButton[]));
  const out = caption ? [caption] : [];
  if (!id) return out;
  const { data, error } = await ctx.db.from("products").select("name").eq("id", id).maybeSingle();
  if (error) console.warn(`[comment-dm] товар правила не прочитан: ${error.message}`);
  if (data?.name) out.push(data.name);
  return out;
}

/**
 * Пересохранённое правило: Zernio выдаёт ему новый id, а строки очереди
 * хранят старый. Тот же аккаунт и тот же товар кнопки «Купить» — то же
 * правило, обещанное второе сообщение уходит (Копилка 12.10: Кристина
 * пересохранила «Матрешки» в 17:39, toktobiubiudzhaparova ответила
 * «Здравствуйте» — и карточку не получила, «правило удалено»).
 */
export function sameBuyRule(
  rule: CommentAutomation,
  rowButtons: DmButton[] | undefined,
  accountId: string,
): boolean {
  if (rule.accountId && rule.accountId !== accountId) return false;
  const promised = buyButtonProduct(normalizeDmButtons(rowButtons ?? []));
  if (!promised) return false;
  const now = rule.secondDmButtons?.length ? rule.secondDmButtons : (rule.buttons ?? []);
  return buyButtonProduct(normalizeDmButtons(now as DmButton[])) === promised;
}

/** Товар кнопки «Купить» правила: ровно один PROD:<id> среди кнопок, иначе null. */
export function buyButtonProduct(buttons: DmButton[]): string | null {
  const ids = new Set(
    buttons
      .filter((b) => b.type === "postback" && typeof b.payload === "string")
      .map((b) => b.payload!)
      .filter((x) => x.startsWith("PROD:"))
      .map((x) => x.slice("PROD:".length).trim())
      .filter(Boolean),
  );
  return ids.size === 1 ? [...ids][0]! : null;
}

/** Покупатель написал в Direct первым — отдать ему обещанное второе сообщение из очереди. */
export async function deliverPendingTwoStepDm(
  ctx: TenantContext,
  p: TwoStepBuyer,
  api: AutomationApi = liveAutomationApi,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  if (!p.username) return false;
  // Ждём ответа покупателя сутки: позже «Купить» старого видео сбивает.
  const cutoff = new Date(now().getTime() - PENDING_TWO_STEP_MS).toISOString();
  const logs = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, status, error_message, payload")
        .eq("event_type", "two_step_dm_pending")
        .in("status", ["pending", "processing"])
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    "[zernio] очередь вторых сообщений не прочитана",
  );
  // Свой — по имени или по id автора комментария: в первом сообщении новой
  // переписки Zernio кладёт в имя отправителя цифровой id, и строка с именем
  // из комментария по имени не находилась (Кристина Дидактика, 07.10: «+» от
  // «@1407411881513987», комментарий от «@dolphin.2023841»).
  const own = (logs as PendingRow[]).filter((l) => ownTwoStepRow(l.payload, p));
  // Работает только последнее видео: строки новее первыми, берём первую.
  // Прежние закроются, когда эту заберём к отправке.
  const matched = own[0];
  if (!matched) return false;
  const pl = matched.payload as {
    secondText?: string;
    buttons?: DmButton[];
    attempts?: number;
    noExpress?: boolean;
    automationId?: string;
  };
  // Правило удалено или выключено — его «Купить» не шлём (AATeach 11.10: «День
  // хлеба» убрали, а 55 человек из очереди всё равно получили бы его). Список
  // правил не прочитан или пуст — шлём: правило было живым, когда строку ставили.
  if (pl.automationId && matched.status === "pending") {
    let alive = true;
    try {
      const rules = await listAutomations(ctx, api);
      // Пустой список — правил не видно вовсе (нет подключения), а не «удалено».
      alive =
        rules.length === 0 ||
        rules.some(
          (a) =>
            a.isActive !== false &&
            (automationId(a) === pl.automationId || sameBuyRule(a, pl.buttons, p.accountId)),
        );
    } catch (e) {
      console.warn(`[comment-dm] правила не прочитаны, второе шлём: ${String(e)}`);
    }
    if (!alive) {
      let gone = ctx.db
        .from("zernio_logs")
        .update({ status: "skipped", error_message: RULE_GONE })
        .eq("id", matched.id)
        .eq("status", "pending");
      gone =
        matched.error_message == null
          ? gone.is("error_message", null)
          : gone.eq("error_message", matched.error_message);
      await gone;
      return false;
    }
  }
  const text = pl.secondText?.trim() || DEFAULT_SECOND_DM;
  const attempts = typeof pl.attempts === "number" ? pl.attempts : 0;

  if (matched.status === "processing") {
    // Два быстрых сообщения покупателя — второе сообщение уже в пути у
    // соседнего вебхука; «+» отсюда тоже не разбираем.
    const claim = parseClaim(matched.error_message);
    if (claim && now().getTime() - claim.at < TWO_STEP_CLAIM_STALE_MS) return true;
    const delivered = await alreadyDelivered(api, p, text, claim?.at ?? 0);
    if (delivered === null) return false;
    if (delivered) {
      const done = ctx.db
        .from("zernio_logs")
        .update({ event_type: "two_step_dm_sent", status: "processed", error_message: null })
        .eq("id", matched.id)
        .eq("status", "processing");
      await (matched.error_message == null
        ? done.is("error_message", null)
        : done.eq("error_message", matched.error_message));
      return true;
    }
    if (attempts >= TWO_STEP_MAX_ATTEMPTS) {
      await ctx.db
        .from("zernio_logs")
        .update({
          status: "failed",
          error_message: `второе сообщение не ушло за ${TWO_STEP_MAX_ATTEMPTS} попытки`,
        })
        .eq("id", matched.id)
        .eq("status", "processing");
      return false;
    }
  }

  // Захват условной записью: забирает тот, чья запись прошла, остальные не
  // шлют. Зависшую строку перехватываем по той же метке захвата.
  const token = claimToken(now(), attempts + 1);
  let claimQuery = ctx.db
    .from("zernio_logs")
    .update({
      status: "processing",
      error_message: token,
      payload: { ...(matched.payload as Record<string, Json>), attempts: attempts + 1 },
    })
    .eq("id", matched.id)
    .eq("status", matched.status);
  claimQuery =
    matched.error_message == null
      ? claimQuery.is("error_message", null)
      : claimQuery.eq("error_message", matched.error_message);
  const { data: claimed, error: claimError } = await claimQuery.select("id");
  if (claimError) {
    console.warn(`[comment-dm] ${ctx.tenant.id}: второй шаг не захвачен: ${claimError.message}`);
    return false;
  }
  if (!claimed?.length) return true;
  await supersedeOlderTwoStep(ctx, p, { id: matched.id }, now);
  // Одно второе сообщение в переписку, каким бы путём и по какому бы правилу
  // оно ни шло: строка из очереди, которую обогнал «+», закрывается без
  // отправки (Кристина Дидактика, 07.10: «+» пришёл с цифровым id вместо
  // имени, второе ушло по переписке, а строка вебхука с настоящим именем
  // дождалась «Купить» и прислала то же второе сообщение ещё раз).
  const buyer = await claimConversationSecondStep(ctx, p.conversationId, `row:${matched.id}`, now);
  if (buyer.result !== "won") {
    await ctx.db
      .from("zernio_logs")
      .update(
        buyer.result === "taken"
          ? { event_type: "two_step_dm_sent", status: "processed", error_message: ALREADY_SENT }
          : { status: matched.status, error_message: matched.error_message },
      )
      .eq("id", matched.id)
      .eq("status", "processing")
      .eq("error_message", token);
    return false;
  }
  const buttons = normalizeDmButtons(Array.isArray(pl.buttons) ? pl.buttons : []);
  // Быстрая покупка: товар «Купить» сразу становится заказом, второе
  // сообщение правила не шлём. Упала посреди — могла уже написать
  // покупателю: второе сообщение вдогонку не шлём, отмечаем как ушедшее.
  const productId = p.express && pl.noExpress !== true ? buyButtonProduct(buttons) : null;
  let expressed = false;
  if (productId && p.express) {
    try {
      expressed = await p.express(productId);
    } catch (e) {
      console.warn(`[comment-dm] ${ctx.tenant.id}: быстрая покупка упала: ${String(e)}`);
      expressed = true;
    }
  }
  // Ключ идемпотентности — от строки очереди, а не от вебхука: повтор после
  // зависшего захвата приходит с другим вебхуком, и если первая отправка всё
  // же ушла, Zernio вернёт её ответ, а не пошлёт второе сообщение.
  const r = expressed
    ? { ok: true as const }
    : await api.inbox(p.conversationId, p.accountId, text, {
        buttons: buttons.length ? buttons : undefined,
        platform: "instagram",
        idempotencyScope: `two-step-dm:${matched.id}`,
      });
  if (!r.ok) {
    // Не ушло — вернуть в очередь (или сдаться после предела попыток):
    // следующий ответ покупателя попробует снова.
    await buyer.release();
    const last = attempts + 1 >= TWO_STEP_MAX_ATTEMPTS;
    await ctx.db
      .from("zernio_logs")
      .update({ status: last ? "failed" : "pending", error_message: r.error ?? null })
      .eq("id", matched.id)
      .eq("status", "processing")
      .eq("error_message", token);
    return false;
  }
  // Отметка — только по своей метке захвата: строку, которую за это время
  // перехватил другой вебхук, не трогаем.
  await ctx.db
    .from("zernio_logs")
    .update({
      event_type: "two_step_dm_sent",
      status: "processed",
      error_message: null,
      // Когда ушло — для twoStepJustDelivered: «+», отправленный раньше, не уходит магазину.
      payload: {
        ...(matched.payload as Record<string, Json>),
        attempts: attempts + 1,
        sent_at: now().toISOString(),
        ...(expressed && productId ? { express: productId } : {}),
      },
    })
    .eq("id", matched.id)
    .eq("status", "processing")
    .eq("error_message", token);
  return true;
}

const JUST_DELIVERED_MS = 2 * 60_000;

/**
 * Строки второго шага бывают только этих двух типов. Фильтр по типу идёт по
 * индексу: один `like` по event_id индексом не пользуется и перебирает все
 * журналы магазина за неделю (у живого магазина ~11 тыс. строк, 1,7 с), под
 * нагрузкой — statement timeout (Sentry FROGFLOW-V2-K, 07.10).
 */
const TWO_STEP_TYPES = ["two_step_dm_pending", "two_step_dm_sent"];

/**
 * Ответ покупателя пришёл вдогонку к уже забранному второму сообщению. Два
 * быстрых «+» — два вебхука: если второй прочитал очередь после захвата
 * первым, deliverPendingTwoStepDm вернёт false, и «+» ушёл бы магазину —
 * покупатель получил бы выбор языка сразу после второго сообщения.
 * Вдогонку — это пока второе сообщение ещё отправляется, или отправлено
 * позже, чем покупатель написал (`sentAt` события): того, что набрано уже
 * после второго сообщения («1» — страна оплаты), это не касается.
 */
export async function twoStepJustDelivered(
  ctx: TenantContext,
  username: string,
  messageSentAt: string | null,
): Promise<boolean> {
  if (!username) return false;
  const since = Date.now() - JUST_DELIVERED_MS;
  const typedAt = messageSentAt ? Date.parse(messageSentAt) : NaN;
  const data = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("status, error_message, payload")
        .in("event_type", TWO_STEP_TYPES)
        .like("event_id", "two-step-dm:%")
        .in("status", ["processing", "processed"])
        .gte("created_at", new Date(Date.now() - PENDING_TWO_STEP_DAYS * 86_400_000).toISOString())
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    "[zernio] отправки вторых сообщений не прочитаны",
  );
  return data.some((l) => {
    const pl = l.payload as { username?: string; sent_at?: string } | null;
    if (typeof pl?.username !== "string" || pl.username.toLowerCase() !== username.toLowerCase())
      return false;
    if (l.status === "processing") {
      const claim = parseClaim(l.error_message as string | null);
      return claim !== null && claim.at >= since;
    }
    if (typeof pl.sent_at !== "string") return false;
    const sentAt = Date.parse(pl.sent_at);
    return sentAt >= since && typedAt < sentAt;
  });
}

/** Сколько назад ушедшая кнопка «Купить» ещё считается «в сообщении выше». */
export const BUY_BUTTON_RECENT_MS = 24 * 60 * 60_000;

/**
 * Кнопка «Купить» правила, ушедшая этому покупателю за последние сутки: её
 * заголовок. Ответ страной под таким постом — «нажмите «Купить» выше», а не
 * «продавец ответит» (AATeach, ночь 11.10). Свой — по имени или id автора.
 */
export async function recentBuyButton(
  ctx: TenantContext,
  who: { username?: string | null; senderId?: string | null },
  now = Date.now(),
): Promise<string | null> {
  return (await recentBuyDmButton(ctx, who, now))?.title ?? null;
}

/**
 * Сама кнопка «Купить» (название и PROD:<id>) последнего второго сообщения
 * правила этому покупателю за BUY_BUTTON_RECENT_MS; нет — null. На «Как
 * можно получить» бот присылает её ещё раз (Копилка 12.10, boranbaeva__ainur).
 */
export async function recentBuyDmButton(
  ctx: TenantContext,
  who: { username?: string | null; senderId?: string | null },
  now = Date.now(),
): Promise<{ title: string; payload: string } | null> {
  const username = who.username?.toLowerCase() ?? "";
  if (!username && !who.senderId) return null;
  const data = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("payload")
        .eq("event_type", "two_step_dm_sent")
        .like("event_id", "two-step-dm:%")
        .eq("status", "processed")
        .gte("created_at", new Date(now - BUY_BUTTON_RECENT_MS).toISOString())
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    "[zernio] отправки вторых сообщений не прочитаны",
  );
  for (const l of data) {
    const pl = l.payload as { username?: string; authorId?: string; buttons?: DmButton[] } | null;
    const own =
      (typeof pl?.username === "string" && pl.username.toLowerCase() === username) ||
      (Boolean(who.senderId) && pl?.authorId === who.senderId);
    if (!own) continue;
    const buttons = Array.isArray(pl?.buttons) ? pl.buttons : [];
    const buy = buttons.find(
      (b) =>
        b?.type === "postback" && typeof b.payload === "string" && b.payload.startsWith("PROD:"),
    );
    if (buy?.title) return { title: buy.title, payload: buy.payload! };
  }
  return null;
}

/** Сколько после первого сообщения правила «+» ещё отдаёт второе по переписке. */
export const TWO_STEP_FROM_DM_MS = 30 * 60_000;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Первое сообщение какого двухшагового правила лежит в переписке: точный текст, иначе тот же текст продавца с прежним призывом. */
function ruleOfFirstDm(text: string, rules: CommentAutomation[]): CommentAutomation | null {
  const t = squash(text);
  const exact = rules.find((a) =>
    [a.firstMessage ?? a.dmMessage, ...(a.dmMessageVariations ?? [])].some(
      (v) => v && (squash(v) === t || squash(withReplyPrompt(v, a.replyPrompt)) === t),
    ),
  );
  if (exact) return exact;
  // Первое сообщение могло уйти до замены призыва: узнаём его по тексту
  // продавца без призыва. Один призыв в конце правило не называет — чужое
  // сообщение с тем же «ответьте «+»» (материал «Зори» под бесплатным постом)
  // оформляло «Палитру» (Копилка, 12.10, заказ #144).
  const byBody = rules.filter((a) => {
    const prompts = [...replyPromptsOf(a.replyPrompt), ...KNOWN_PROMPTS];
    const body = withoutPrompt(t, prompts);
    if (body === t || !body) return false;
    return [a.firstMessage ?? a.dmMessage, ...(a.dmMessageVariations ?? [])].some(
      (v) => v && withoutPrompt(squash(v), prompts) === body,
    );
  });
  return byBody.length === 1 ? byBody[0]! : null;
}

const KNOWN_PROMPTS: readonly string[] = [DEFAULT_REPLY_PROMPT, ...LEGACY_REPLY_PROMPTS];

/** Текст без призыва в конце (если он кончается одним из `prompts`). */
function withoutPrompt(t: string, prompts: readonly string[]): string {
  for (const p of prompts) {
    const q = squash(p);
    if (q && t.endsWith(q)) return t.slice(0, -q.length).trim();
  }
  return t;
}

/**
 * «+» пришёл, а второго сообщения в очереди нет: вебхук комментария от Zernio
 * опаздывает или не приходит вовсе, и покупатель получал второе только после
 * следующей реплики, а «+» уходил продавцу обращением (Кристина Дидактика,
 * 07.10, обращение #25). Первое сообщение правила уже лежит в переписке — по
 * нему узнаём правило и ставим второе в очередь сами. Ключ — id первого
 * сообщения: два «+» подряд дают одну строку, отправку забирает
 * deliverPendingTwoStepDm. Вебхук комментария или крон, пришедшие потом,
 * видят строку и второй раз не шлют (sendSecondStep).
 */
export async function deliverTwoStepFromDm(
  ctx: TenantContext,
  p: TwoStepBuyer,
  api: AutomationApi = liveAutomationApi,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  if (!p.username) return false;
  let tail: ZernioInboxMessage[];
  try {
    tail = await api.tail(p.accountId, p.conversationId);
  } catch (e) {
    console.warn(`[comment-dm] переписка не прочитана: ${e instanceof Error ? e.message : e}`);
    return false;
  }
  const since = now().getTime() - TWO_STEP_FROM_DM_MS;
  const outgoing = tail.filter(
    (m) => m.direction === "outgoing" && m.message && Date.parse(m.createdAt ?? "") >= since,
  );
  if (outgoing.length === 0) return false;
  const rules = (await listAutomations(ctx, api)).filter(
    (a) =>
      (a.twoStepDm || Boolean(a.buttons?.length)) &&
      a.isActive !== false &&
      a.accountId === p.accountId,
  );
  if (rules.length === 0) return false;
  // Последнее первое сообщение правила; после него уже было своё исходящее —
  // второе ушло или разговор пошёл дальше, это не наш «+».
  const last = outgoing.at(-1)!;
  const rule = ruleOfFirstDm(last.message!, rules);
  if (!rule) return false;
  const autoId = automationId(rule);
  const firstAt = Date.parse(last.createdAt!);

  // Строка второго шага этому покупателю по этому правилу после первого
  // сообщения уже есть (вебхук успел или «+» уже был) — новую не заводим.
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, payload")
        .in("event_type", TWO_STEP_TYPES)
        .like("event_id", "two-step-dm:%")
        .gte("created_at", new Date(firstAt - 60_000).toISOString())
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    "[zernio] вторые сообщения не прочитаны",
  );
  const known = rows.some((r) => {
    const pl = r.payload as { username?: string; authorId?: string; automationId?: string } | null;
    return (
      pl?.automationId === autoId &&
      (pl.username?.toLowerCase() === p.username.toLowerCase() ||
        (Boolean(p.senderId) && pl.authorId === p.senderId))
    );
  });
  if (!known) {
    const { error } = await ctx.db.from("zernio_logs").insert({
      bot_id: ctx.tenant.id,
      event_id: `${DM_KEY_PREFIX}${last.id ?? `${p.conversationId}:${firstAt}`}`,
      event_type: "two_step_dm_pending",
      status: "pending",
      error_message: null,
      created_at: now().toISOString(),
      payload: {
        username: p.username,
        accountId: p.accountId,
        automationId: autoId,
        secondText: rule.secondDmMessage || DEFAULT_SECOND_DM,
        buttons: toJson(
          normalizeDmButtons(
            (rule.secondDmButtons?.length
              ? rule.secondDmButtons
              : rule.buttons?.length
                ? rule.buttons
                : defaultButtons(ctx)) as DmButton[],
          ),
        ),
        createdAt: now().toISOString(),
      },
    });
    // Конфликт ключа — соседний «+» уже поставил ту же строку.
    if (error && !/duplicate|unique/i.test(error.message)) {
      console.warn(`[comment-dm] второй шаг по переписке не записан: ${error.message}`);
      return false;
    }
  }
  return deliverPendingTwoStepDm(ctx, p, api, now);
}

/**
 * «+» ответом на сообщение с призывом, которое не узнано ни как первое
 * сообщение правила (материал «Зори» под бесплатным постом, не наше правило):
 * товар не угадываем — покупателю вопрос, какой материал нужен (Копилка,
 * 12.10, заказ #144 «Палитра» вместо карточек). След в журнале — чтобы при
 * разборе было видно, на какое сообщение ответили.
 */
export async function plusAnswersUnknownPrompt(
  ctx: TenantContext,
  p: TwoStepBuyer,
  api: AutomationApi = liveAutomationApi,
  now: () => Date = () => new Date(),
  /** Покупатель написал голый «+». */
  bare = false,
): Promise<"ask" | "asked" | null> {
  let tail: ZernioInboxMessage[];
  try {
    tail = await api.tail(p.accountId, p.conversationId);
  } catch (e) {
    console.warn(`[comment-dm] переписка не прочитана: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  const since = now().getTime() - TWO_STEP_FROM_DM_MS;
  const last = tail
    .filter(
      (m) => m.direction === "outgoing" && m.message && Date.parse(m.createdAt ?? "") >= since,
    )
    .at(-1);
  // Голый «+», а в переписке Zernio наших сообщений нет: первое сообщение
  // прислали вручную, и Zernio его не показал (Копилка 12.10, maryyyyisaaaa —
  // «+» на «Палитру» ушёл в обращение #147). Спрашиваем, какой материал, —
  // раз в сутки на переписку.
  if (!last?.message && !bare) return null;
  if (last?.message) {
    const t = squash(last.message);
    const prompted =
      /[«"“]\s*\+\s*[»"”]/.test(t) || KNOWN_PROMPTS.some((q) => t.endsWith(squash(q)));
    if (!prompted) return null;
  }
  const day = Math.floor(now().getTime() / 86_400_000);
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: last?.message
      ? `plus-unmatched:${last.id ?? `${p.conversationId}:${Date.parse(last.createdAt ?? "")}`}`
      : `plus-unmatched:${p.conversationId}:day:${day}`,
    event_type: "two_step_dm_unmatched",
    status: "skipped",
    error_message: "«+» на сообщение, которое не первое сообщение правила — спросили, какой товар",
    created_at: now().toISOString(),
    payload: toJson({
      username: p.username,
      accountId: p.accountId,
      conversationId: p.conversationId,
      answered: last?.message?.slice(0, 300) ?? null,
    }),
  });
  // Повторный «+» на то же сообщение — вопрос уже задан, второй раз не спрашиваем.
  if (error && /duplicate|unique/i.test(error.message)) return "asked";
  // Не записали — не знаем, спрашивал ли соседний вебхук: «+» идёт дальше как раньше.
  if (error) {
    console.warn(`[comment-dm] след «+» без правила не записан: ${error.message}`);
    return null;
  }
  return "ask";
}

/** Кодовое слово в Direct — короткая реплика, а не рассказ, где слово встретилось. */
export const DM_KEYWORD_MAX_LEN = 40;

/**
 * Кодовое слово из рилса написали прямо в Direct («Палитра»), без
 * комментария: раньше бот открывал обращение и молчал (Копилка русоведа,
 * 09.10: ~13 человек за 2 часа). Покупатель написал сам — второе сообщение
 * правила с кнопками можно слать сразу, «+» не нужен. Только правила с
 * кодовыми словами (правило «на любой комментарий» на любую реплику не
 * срабатывает). Строка очереди — на переписку и правило в пределах окна
 * TWO_STEP_FROM_DM_MS: два «Палитра» подряд дают одну строку, а право на
 * отправку в переписку одно (sendSecondStep) — дубля не будет.
 */
export async function deliverTwoStepForDmKeyword(
  ctx: TenantContext,
  p: TwoStepBuyer,
  text: string,
  api: AutomationApi = liveAutomationApi,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  const t = text.trim();
  if (!p.username || !t || t.length > DM_KEYWORD_MAX_LEN) return false;
  // «Палитру я у вас покупала» — рассказ о купленном, не просьба (#146).
  if (mentionsOwnedProduct(t)) return false;
  const all = await listAutomations(ctx, api);
  const rules = all.filter(
    (a) =>
      (a.twoStepDm || Boolean(a.buttons?.length)) &&
      a.isActive !== false &&
      a.accountId === p.accountId &&
      // Тип правила не смотрим: Zernio может отдать его иначе, чем мы пишем,
      // а ответ на историю — тоже личка (Копилка, 09.10: «Палитра» ответом
      // на историю ушла в обращение #50).
      (a.keywords ?? []).some((k) => typeof k === "string" && k.trim() !== ""),
  );
  const rule =
    rules.find((a) => commentMatchesAutomation(t, a.keywords, a.matchMode)) ??
    (await ruleNamedInDm(ctx, t, all, p.accountId));
  if (!rule) {
    // След для разбора: какие правила видели и почему ни одно не подошло
    // (обращение #50 Копилки ушло без следа). Только когда правила вообще есть.
    if (all.length > 0) {
      const { error } = await ctx.db.from("zernio_logs").insert({
        bot_id: ctx.tenant.id,
        event_id: `dm-keyword-miss:${p.conversationId}:${now().getTime()}`,
        event_type: "dm_keyword_miss",
        status: "skipped",
        error_message: rules.length ? "кодовое слово не совпало" : "нет подходящих правил",
        created_at: now().toISOString(),
        payload: toJson({
          text: t,
          accountId: p.accountId,
          rules: all.map((a) => ({
            id: automationId(a),
            accountId: a.accountId ?? null,
            trigger: a.trigger ?? null,
            keywords: a.keywords ?? null,
            matchMode: a.matchMode ?? null,
            twoStepDm: a.twoStepDm ?? null,
            buttons: a.buttons?.length ?? 0,
            isActive: a.isActive ?? null,
            name: a.name ?? null,
            postTitle: a.postTitle ?? null,
          })),
        }),
      });
      if (error) console.warn(`[comment-dm] след промаха не записан: ${error.message}`);
    }
    return false;
  }
  const autoId = automationId(rule);
  const bucket = Math.floor(now().getTime() / TWO_STEP_FROM_DM_MS);
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: `${DM_KEY_PREFIX}kw:${p.conversationId}:${autoId}:${bucket}`,
    event_type: "two_step_dm_pending",
    status: "pending",
    error_message: null,
    created_at: now().toISOString(),
    payload: {
      username: p.username,
      authorId: p.senderId ?? null,
      accountId: p.accountId,
      automationId: autoId,
      secondText: rule.secondDmMessage || DEFAULT_SECOND_DM,
      buttons: toJson(
        normalizeDmButtons(
          (rule.secondDmButtons?.length
            ? rule.secondDmButtons
            : rule.buttons?.length
              ? rule.buttons
              : defaultButtons(ctx)) as DmButton[],
        ),
      ),
      createdAt: now().toISOString(),
      via: "dm_keyword",
    },
  });
  if (error && !/duplicate|unique/i.test(error.message)) {
    console.warn(`[comment-dm] кодовое слово в Direct не записано: ${error.message}`);
    return false;
  }
  return deliverPendingTwoStepDm(ctx, p, api, now);
}

/** Слова, которые есть почти в любом тексте правила и товара не называют. */
const GENERIC_DM_WORDS = new Set(
  (
    "здравствуйте привет добрый день вечер утро хочу цена сколько стоит купить " +
    "оплата оплатить можно пожалуйста спасибо материал материалы файл заказ заказать " +
    "сәлеметсіз сәлем рахмет hello hi price want buy thanks salom narxi"
  ).split(" "),
);

/**
 * Слова просьбы рядом с названием в Direct («Хочу Палитру», «Палитра нужна,
 * пришлите»): с ними реплика остаётся просьбой. Любое другое слово делает её
 * рассказом или вопросом о товаре — продажу не начинаем.
 */
const DM_REQUEST_WORDS = new Set(
  (
    "нужна нужно нужен нужны надо дайте пришлите отправьте скиньте вышлите " +
    "интересует интересно хотела хотел хотим подробнее информация информацию " +
    "давайте"
  ).split(" "),
);

/**
 * Покупатель говорит, что товар у него уже есть или был куплен
 * («Выразит.средства я у вас покупала», «Палитру уже оплатила»): это рассказ,
 * а не просьба — ни сообщения с «Купить», ни быстрой покупки (Копилка, заказ
 * #146, 12.10).
 */
const ALREADY_OWNS =
  /(?:^|[^\p{L}])(?:по|при|за|о)?(?:купил|куплен|купал|брал|оплатил|оплачен|оплачивал|приобрел|приобрёл|заказывал|получил|пришла|пришел|пришло)\p{L}*|уже\s+есть|у\s+меня\s+есть|есть\s+у\s+меня|сатып\s+алдым/iu;

export function mentionsOwnedProduct(text: string): boolean {
  return ALREADY_OWNS.test(text.toLowerCase().replace(/ё/g, "е"));
}

function dmWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4);
}

/** Слова совпадают или отличаются одной буквой («Политра» — «Палитра»). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Слова в кавычках: «Пишите в комментариях слово "Палитра"» — кодовое слово поста. */
function quotedWords(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(/[«"“„']([^«»"“”„']{2,40})[»"”“']/g)].map((x) => x[1]!);
}

/**
 * Правило «любой комментарий» (список кодовых слов пуст) в Direct по самому
 * списку не узнать (Копилка, 09.10: у рилса «Палитра» слова не вписаны,
 * «Палитра» в личке молчала). Узнаём только по тому, что называет товар:
 * название правила, название товара кнопки «Купить» и слово в кавычках из
 * подписи или первого сообщения («Пишите слово "Палитра"»). Остальные слова
 * подписи, сообщений и кнопок не считаются: на них название раздела каталога
 * «Оформление и праздники» вызвало «Купить» Палитры (Копилка, заказ #127,
 * 11.10). Общие слова («хочу», «цена», «здравствуйте») не считаются.
 */
async function ruleNamedInDm(
  ctx: TenantContext,
  text: string,
  all: CommentAutomation[],
  accountId: string,
): Promise<CommentAutomation | undefined> {
  const words = dmWords(text).filter((w) => !GENERIC_DM_WORDS.has(w));
  if (!words.length) return undefined;
  for (const a of all) {
    if (!(a.twoStepDm || Boolean(a.buttons?.length))) continue;
    if (a.isActive === false || a.accountId !== accountId) continue;
    if (hasKeywords(a)) continue;
    const productId = buyButtonProduct(
      normalizeDmButtons(
        (a.secondDmButtons?.length ? a.secondDmButtons : (a.buttons ?? [])) as DmButton[],
      ),
    );
    let productName: string | null = null;
    if (productId) {
      const { data, error } = await ctx.db
        .from("products")
        .select("name")
        .eq("id", productId)
        .maybeSingle();
      if (error) console.warn(`[comment-dm] товар правила не прочитан: ${error.message}`);
      productName = data?.name ?? null;
    }
    const names = [
      a.name,
      productName,
      ...quotedWords(a.postTitle),
      ...quotedWords(a.firstMessage ?? a.dmMessage),
    ].filter((x): x is string => typeof x === "string");
    if (names.some((n) => dmNamesWhole(words, n))) return a;
  }
  return undefined;
}

/**
 * Реплика называет товар целиком: в ней все слова названия («Палитра
 * средств выразительности» — все три, «Палитра» — одно), а остальные слова —
 * только просьба («хочу», «пришлите»). Одно слово из длинного названия
 * («средства») или рассказ вокруг названия правило не включают: на «Выразит.
 * средства я у вас покупала» бот прислал Палитру с «Купить», и вышел заказ
 * #146 на уже купленный материал (Копилка, 12.10).
 */
function dmNamesWhole(words: string[], name: string): boolean {
  const nameWords = dmWords(name).filter((w) => !GENERIC_DM_WORDS.has(w));
  if (!nameWords.length) return false;
  if (!nameWords.every((n) => words.some((w) => sameWord(w, n)))) return false;
  return words.every((w) => DM_REQUEST_WORDS.has(w) || nameWords.some((n) => sameWord(w, n)));
}

function hasKeywords(a: Pick<CommentAutomation, "keywords">): boolean {
  return (a.keywords ?? []).some((k) => typeof k === "string" && k.trim() !== "");
}

/**
 * Быстрая покупка (сразу заказ на товар «Купить») — только когда покупатель
 * правда просил этот товар: правило с кодовыми словами (комментарий их
 * прошёл) или комментарий называет товар словами правила. Правило «любой
 * комментарий» иначе оформляло «Палитру» на «Уголок» (Копилка, 09.10, заказ
 * #45); такому покупателю уходит обычное второе сообщение с кнопкой.
 */
export function expressAllowed(
  commentText: string,
  rule: Pick<
    CommentAutomation,
    | "keywords"
    | "name"
    | "postTitle"
    | "firstMessage"
    | "dmMessage"
    | "secondDmMessage"
    | "buttons"
    | "secondDmButtons"
  >,
  extra: Array<string | null | undefined> = [],
): boolean {
  // «Палитра у меня уже есть» — не заказ, даже если слово правила совпало (#146).
  if (mentionsOwnedProduct(commentText)) return false;
  if (hasKeywords(rule)) return true;
  const words = dmWords(commentText).filter((w) => !GENERIC_DM_WORDS.has(w));
  return words.length > 0 && wordsNameRule(words, rule, extra);
}

function wordsNameRule(
  words: string[],
  a: Pick<
    CommentAutomation,
    | "name"
    | "postTitle"
    | "firstMessage"
    | "dmMessage"
    | "secondDmMessage"
    | "buttons"
    | "secondDmButtons"
  >,
  extra: Array<string | null | undefined> = [],
): boolean {
  const ruleWords = dmWords(
    [
      a.name,
      a.postTitle,
      a.firstMessage ?? a.dmMessage,
      a.secondDmMessage,
      ...(a.buttons ?? []).map((b) => b.title),
      ...(a.secondDmButtons ?? []).map((b) => b.title),
      ...extra,
    ]
      .filter((x): x is string => typeof x === "string")
      .join(" "),
  );
  return words.some((w) => ruleWords.some((r) => sameWord(w, r)));
}

/** Строки второго шага, заведённые по ответу покупателя, а не по комментарию. */
const DM_KEY_PREFIX = "two-step-dm:dm:";

const ALREADY_SENT = "второе сообщение этому покупателю уже ушло";

/**
 * Право отправить второе сообщение в эту переписку: одно за
 * TWO_STEP_FROM_DM_MS, какое бы правило и какой бы путь его ни слал —
 * вебхук комментария, крон, очередь на ответ покупателя, «+» по переписке.
 * Ключ — переписка, а не имя: имя отправителя Zernio в первом сообщении
 * присылает цифрами, а в следующих — настоящее, и строки одного покупателя
 * по имени не сходились (#567 не помог). Захват — условная запись по метке
 * `<время>|<владелец>` в одной строке на переписку: из двух одновременных
 * записей проходит одна. Владелец — строка, которая шлёт; её повтор после
 * зависшего захвата право не теряет. Не прочитали — "unknown": не шлём
 * вслепую, строка ждёт следующего сообщения.
 */
async function claimConversationSecondStep(
  ctx: TenantContext,
  conversationId: string,
  owner: string,
  now: () => Date = () => new Date(),
): Promise<{ result: "won" | "taken" | "unknown"; release: () => Promise<void> }> {
  const key = `two-step-conv:${conversationId}`;
  const at = now();
  const mark = `${at.toISOString()}|${owner}`;
  const noop = async () => {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: row, error } = await ctx.db
      .from("zernio_logs")
      .select("id, error_message")
      .eq("event_id", key)
      .maybeSingle();
    if (error) {
      console.warn(`[comment-dm] отметка второго сообщения не прочитана: ${error.message}`);
      return { result: "unknown", release: noop };
    }
    if (!row) {
      const { error: insErr } = await ctx.db.from("zernio_logs").insert({
        bot_id: ctx.tenant.id,
        event_id: key,
        event_type: "two_step_conversation",
        status: "processed",
        error_message: mark,
        payload: { conversationId },
      });
      if (!insErr)
        return {
          result: "won",
          release: async () => {
            await ctx.db.from("zernio_logs").delete().eq("event_id", key).eq("error_message", mark);
          },
        };
      if (/duplicate|unique/i.test(insErr.message)) continue; // соседний путь успел первым
      console.warn(`[comment-dm] отметка второго сообщения не записана: ${insErr.message}`);
      return { result: "unknown", release: noop };
    }
    const prev = (row.error_message as string | null) ?? "";
    const [prevAt, prevOwner] = prev.split("|");
    if (prevOwner === owner) return { result: "won", release: noop };
    const prevMs = Date.parse(prevAt ?? "");
    if (Number.isFinite(prevMs) && at.getTime() - prevMs < TWO_STEP_FROM_DM_MS)
      return { result: "taken", release: noop };
    let cas = ctx.db.from("zernio_logs").update({ error_message: mark }).eq("id", row.id);
    cas = row.error_message == null ? cas.is("error_message", null) : cas.eq("error_message", prev);
    const { data: won, error: casErr } = await cas.select("id");
    if (casErr) {
      console.warn(`[comment-dm] отметка второго сообщения не записана: ${casErr.message}`);
      return { result: "unknown", release: noop };
    }
    if (!won?.length) return { result: "taken", release: noop };
    return {
      result: "won",
      release: async () => {
        await ctx.db
          .from("zernio_logs")
          .update({ error_message: row.error_message })
          .eq("id", row.id)
          .eq("error_message", mark);
      },
    };
  }
  return { result: "taken", release: noop };
}

/** Публичный ответ под комментарием: основной или один из вариантов, наугад — как у Zernio. */
export function pickCommentReply(
  a: Pick<CommentAutomation, "commentReply" | "commentReplyVariations">,
  random: () => number = Math.random,
): string {
  const all = [a.commentReply, ...(a.commentReplyVariations ?? [])]
    .map((t) => t?.trim() ?? "")
    .filter(Boolean);
  return all[Math.floor(random() * all.length)] ?? "";
}

export type CatchupInput = {
  postId: string;
  accountId: string;
  commentIds: string[];
  message: string;
  buttons?: AutomationButton[];
  twoStepDm?: boolean;
  secondDmMessage?: string;
};

/** Догоняющие private-reply по явно выбранным комментариям, последовательно (rate limit Zernio). */
export async function sendCatchupPrivateReplies(
  ctx: TenantContext,
  input: CatchupInput,
  api: AutomationApi = liveAutomationApi,
): Promise<Array<{ commentId: string; ok: boolean; error?: string }>> {
  if (!ownsZernioAccount(ctx, input.accountId)) throw new Error("Чужой аккаунт Instagram");
  const results: Array<{ commentId: string; ok: boolean; error?: string }> = [];
  let comments: InstagramComment[] | null = null;
  for (const commentId of input.commentIds.slice(0, 25)) {
    const r = await api.privateReply(
      input.postId,
      commentId,
      input.accountId,
      input.message,
      // Кнопки в private-reply Instagram не показывает тем, кто не подписан, а
      // отказ тратит единственный ответ на комментарий: первое — только текст.
      [],
    );
    const twoStep = input.twoStepDm || Boolean(input.buttons?.length);
    if (r.ok && twoStep) {
      await sleep(1500);
      comments ??= await api.comments(input.postId, input.accountId);
      const username = comments.find((c) => c.id === commentId)?.from?.username;
      const buttons = input.buttons?.length ? input.buttons : defaultButtons(ctx);
      if (username && buttons.length)
        await sendSecondStep(
          ctx,
          {
            accountId: input.accountId,
            automationId: "",
            commentId,
            username,
            secondText: input.secondDmMessage || DEFAULT_SECOND_DM,
            buttons,
          },
          api,
        );
    }
    results.push({ commentId, ...r });
  }
  return results;
}

export async function sendCatchupCommentReplies(
  ctx: TenantContext,
  input: { postId: string; accountId: string; commentIds: string[]; message: string },
  api: AutomationApi = liveAutomationApi,
): Promise<Array<{ commentId: string; ok: boolean; error?: string }>> {
  if (!ownsZernioAccount(ctx, input.accountId)) throw new Error("Чужой аккаунт Instagram");
  const results: Array<{ commentId: string; ok: boolean; error?: string }> = [];
  for (const commentId of input.commentIds.slice(0, 25))
    results.push({
      commentId,
      ...(await api.publicReply(input.postId, commentId, input.accountId, input.message)),
    });
  return results;
}

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
  const active = all
    .filter((a) => a.isActive !== false && a.trigger !== "story_reply" && a.platformPostId)
    .filter((a) => automationId(a))
    .sort((a, b) => (automationId(a) < automationId(b) ? -1 : 1));
  // Обход по кругу с места, где остановились: правила за пределом одного запуска не теряются.
  const cursor = await getSetting(ctx, FALLBACK_CURSOR_KEY);
  const start = cursor ? active.findIndex((a) => automationId(a) >= cursor) : 0;
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

        const { error: reserveError } = await ctx.db.from("comment_dm_fallback_sends").insert({
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
        if (!reply.ok && altStatus === "sent" && commentReply && !publicByZernio.has(commentId)) {
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
