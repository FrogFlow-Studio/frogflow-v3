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
import { getSetting, setSetting } from "@/core/settings/settings";
import {
  DEFAULT_REPLY_PROMPT,
  DEFAULT_SECOND_DM,
  DM_LIMIT_PLAIN,
  STALE_PENDING_MS,
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
  stripReplyPrompt,
  withReplyPrompt,
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
export async function saveAutomation(
  ctx: TenantContext,
  input: SaveAutomationInput,
  api: AutomationApi = liveAutomationApi,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
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
  const meta: AutomationMeta = {
    twoStepDm: twoStep,
    secondDmMessage: data.secondDmMessage?.trim() || undefined,
    secondDmButtons: twoStep ? (data.buttons ?? []) : undefined,
    unresolvedPrompt: data.unresolvedPrompt?.trim() || undefined,
    replyPrompt: twoStep ? replyPrompt : undefined,
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
      const created = await api.create(body);
      savedId = automationId(created);
      if (!savedId) return { ok: false, error: "Zernio не вернул id правила" };
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
      if (!ok) await claim.release();
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
      createdAt: new Date().toISOString(),
    },
  });
  return ok;
}

export type CommentReceivedPayload = {
  account?: { accountId?: string; id?: string; _id?: string; username?: string };
  post?: { platformPostId?: string; id?: string };
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
  const matched = automations.find((a) => {
    const target = a.platformPostId || a.postId;
    if (target && (!commentPostId || String(target).trim() !== String(commentPostId).trim()))
      return false;
    return commentMatchesAutomation(text, a.keywords, a.matchMode);
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
    },
    api,
  );
  return { note: ok ? `второе сообщение @${username}` : `в очередь pending @${username}` };
}

const PENDING_TWO_STEP_DAYS = 7;
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

/** Покупатель написал в Direct первым — отдать ему обещанное второе сообщение из очереди. */
export async function deliverPendingTwoStepDm(
  ctx: TenantContext,
  p: { accountId: string; conversationId: string; username: string; senderId?: string },
  api: AutomationApi = liveAutomationApi,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  if (!p.username) return false;
  // Private-reply можно отправить в течение 7 дней после комментария — столько
  // и ждём ответа покупателя.
  const cutoff = new Date(now().getTime() - PENDING_TWO_STEP_DAYS * 86_400_000).toISOString();
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
  const own = (logs as PendingRow[]).filter((l) => {
    const pl = l.payload as { username?: string; authorId?: string } | null;
    return (
      (typeof pl?.username === "string" &&
        pl.username.toLowerCase() === p.username.toLowerCase()) ||
      (Boolean(p.senderId) && pl?.authorId === p.senderId)
    );
  });
  const matched = own.find((l) => l.status === "pending") ?? own[0];
  if (!matched) return false;
  const pl = matched.payload as {
    secondText?: string;
    buttons?: DmButton[];
    attempts?: number;
  };
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
  // Ключ идемпотентности — от строки очереди, а не от вебхука: повтор после
  // зависшего захвата приходит с другим вебхуком, и если первая отправка всё
  // же ушла, Zernio вернёт её ответ, а не пошлёт второе сообщение.
  const r = await api.inbox(p.conversationId, p.accountId, text, {
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

/** Сколько после первого сообщения правила «+» ещё отдаёт второе по переписке. */
export const TWO_STEP_FROM_DM_MS = 30 * 60_000;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Первое сообщение какого двухшагового правила лежит в переписке: точный текст, иначе единственный призыв. */
function ruleOfFirstDm(text: string, rules: CommentAutomation[]): CommentAutomation | null {
  const t = squash(text);
  const exact = rules.find((a) =>
    [a.firstMessage ?? a.dmMessage, ...(a.dmMessageVariations ?? [])].some(
      (v) => v && (squash(v) === t || squash(withReplyPrompt(v, a.replyPrompt)) === t),
    ),
  );
  if (exact) return exact;
  const byPrompt = rules.filter((a) => {
    const prompt = squash(a.replyPrompt ?? DEFAULT_REPLY_PROMPT);
    return prompt !== "" && t.endsWith(prompt);
  });
  return byPrompt.length === 1 ? byPrompt[0]! : null;
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
  p: { accountId: string; conversationId: string; username: string; senderId?: string },
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
  p: { accountId: string; conversationId: string; username: string; senderId?: string },
  text: string,
  api: AutomationApi = liveAutomationApi,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  const t = text.trim();
  if (!p.username || !t || t.length > DM_KEYWORD_MAX_LEN) return false;
  const rules = (await listAutomations(ctx, api)).filter(
    (a) =>
      (a.twoStepDm || Boolean(a.buttons?.length)) &&
      a.isActive !== false &&
      a.accountId === p.accountId &&
      (a.trigger ?? "comment") === "comment" &&
      a.keywords.some((k) => k.trim() !== ""),
  );
  const rule = rules.find((a) => commentMatchesAutomation(t, a.keywords, a.matchMode));
  if (!rule) return false;
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
