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
  comments: (postId: string, accountId: string) => Promise<InstagramComment[]>;
  privateReply: (
    postId: string,
    commentId: string,
    accountId: string,
    message: string,
    buttons: AutomationButton[],
  ) => Promise<{ ok: boolean; error?: string }>;
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
  comments: async (postId, accountId) => {
    const all: InstagramComment[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < COMMENTS_MAX_PAGES; page++) {
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
      return {
        ok: false,
        error: explainInstagramPrivateReplyError(e instanceof Error ? e.message : String(e)),
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
  return u ? [{ type: "url", title: "Открыть в Telegram ✈️", url: `https://t.me/${u}` }] : [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Журнал zernio_logs: строка на comment id, upsert без ON CONFLICT (имя индекса в схеме не наше). */
async function upsertLog(
  ctx: TenantContext,
  eventId: string,
  row: { event_type: string; status: string; error_message?: string | null; payload: Json },
): Promise<void> {
  const { data } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();
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
    secondText: string;
    buttons: AutomationButton[];
  },
  api: AutomationApi,
): Promise<boolean> {
  const key = `two-step-dm:${p.commentId}`;
  const buttons = normalizeDmButtons(p.buttons as DmButton[]);
  const { data: known } = await ctx.db
    .from("bot_users")
    .select("zernio_conversation_id")
    .eq("platform", "instagram")
    .ilike("username", p.username)
    .maybeSingle();
  let ok = false;
  let error: string | undefined = "ждём ответа покупателя в Direct";
  if (known?.zernio_conversation_id) {
    const r = await api.inbox(known.zernio_conversation_id, p.accountId, p.secondText, {
      buttons,
      platform: "instagram",
    });
    ok = r.ok;
    error = r.error;
  }
  await upsertLog(ctx, key, {
    event_type: ok ? "two_step_dm_sent" : "two_step_dm_pending",
    status: ok ? "processed" : "pending",
    error_message: ok ? null : (error ?? null),
    payload: {
      commentId: p.commentId,
      username: p.username,
      accountId: p.accountId,
      automationId: p.automationId,
      secondText: p.secondText,
      buttons: buttons as unknown as Json,
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

  const { data: existing } = await ctx.db
    .from("zernio_logs")
    .select("status")
    .eq("event_id", `two-step-dm:${commentId}`)
    .maybeSingle();
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
  p: { accountId: string; conversationId: string; username: string },
  api: AutomationApi = liveAutomationApi,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  if (!p.username) return false;
  // Private-reply можно отправить в течение 7 дней после комментария — столько
  // и ждём ответа покупателя.
  const cutoff = new Date(now().getTime() - PENDING_TWO_STEP_DAYS * 86_400_000).toISOString();
  const { data: logs } = await ctx.db
    .from("zernio_logs")
    .select("id, status, error_message, payload")
    .eq("event_type", "two_step_dm_pending")
    .in("status", ["pending", "processing"])
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(50);
  const own = ((logs ?? []) as PendingRow[]).filter((l) => {
    const pl = l.payload as { username?: string } | null;
    return (
      typeof pl?.username === "string" && pl.username.toLowerCase() === p.username.toLowerCase()
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
  const { data } = await ctx.db
    .from("zernio_logs")
    .select("status, error_message, payload")
    .like("event_id", "two-step-dm:%")
    .in("status", ["processing", "processed"])
    .gte("created_at", new Date(Date.now() - PENDING_TWO_STEP_DAYS * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []).some((l) => {
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
};

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
): Promise<FallbackResult> {
  const result: FallbackResult = { automationsChecked: 0, commentsChecked: 0, sent: 0, failed: 0 };
  if (!ctx.tenant.modules.instagram) return result;
  const perPost = (await listAutomations(ctx, api))
    .filter((a) => a.isActive !== false && a.trigger !== "story_reply" && a.platformPostId)
    .slice(0, MAX_AUTOMATIONS_PER_RUN);
  result.automationsChecked = perPost.length;
  let sendsThisRun = 0;

  for (const automation of perPost) {
    const autoId = automationId(automation);
    const postId = automation.platformPostId!;
    if (!autoId) continue;
    try {
      // Ошибка чтения логов — исключение и пропуск правила: без логов любой
      // комментарий выглядит пропущенным, а это повтор всем, кто уже получил.
      const [comments, { logs, coverage }] = await Promise.all([
        api.comments(postId, automation.accountId),
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
          const { data: log } = await ctx.db
            .from("zernio_logs")
            .select("status")
            .eq("event_id", `two-step-dm:${commentId}`)
            .maybeSingle();
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
            const { data: earlier } = await ctx.db
              .from("comment_dm_fallback_sends")
              .select("comment_id")
              .eq("automation_id", autoId)
              .in("comment_id", siblingIds)
              .limit(1);
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
          const { data: existing } = await ctx.db
            .from("comment_dm_fallback_sends")
            .select("status, created_at, updated_at")
            .eq("automation_id", autoId)
            .eq("comment_id", commentId)
            .maybeSingle();
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
          const { data: takeover } = await ctx.db
            .from("comment_dm_fallback_sends")
            .update({ updated_at: now.toISOString() })
            .eq("automation_id", autoId)
            .eq("comment_id", commentId)
            .eq("status", "pending")
            .lt("updated_at", new Date(now.getTime() - STALE_PENDING_MS).toISOString())
            .select("id");
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
          const { data: buyer } = await ctx.db
            .from("bot_users")
            .select("zernio_conversation_id")
            .eq("user_key", `ig_${comment.from.id}`)
            .maybeSingle();
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
        const commentReply = automation.commentReply?.trim();
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
      console.error(
        `[comment-dm-fallback] ${ctx.tenant.id} правило ${autoId}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  return result;
}

export async function listFallbackSends(ctx: TenantContext, limit = 50) {
  const { data } = await ctx.db
    .from("comment_dm_fallback_sends")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
