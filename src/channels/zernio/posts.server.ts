import type { TenantContext } from "@/core/tenant/resolve.server";
import { serviceDb } from "@/core/db/client.server";
import { isTenantStorageKey } from "@/core/storage/keys";
import {
  postState,
  validatePostDraft,
  zernioPostBody,
  mediaTypeOf,
  type DraftError,
  type MediaType,
  type PostKind,
  type PostState,
} from "@/core/social/post-draft";
import { zernioRequest } from "./api.server";
import { instagramAccounts } from "./automations.server";
import { serverFailure } from "@/lib/server-failure";
import { sha256Hex } from "@/lib/hash";

/**
 * Публикация постов, Reels и сторис в Instagram клиента через Zernio.
 * Файлы продавец кладёт через /api/admin/upload (под префиксом клиента),
 * Zernio забирает их по подписанной ссылке. Каждый пост — строка
 * `post.created` в zernio_logs: по ней список в админке и проверка, что
 * снимать можно только свой пост.
 */
export type PublishInput = {
  kind: PostKind;
  accountIds: string[];
  text: string;
  /** Ключи файлов в хранилище; тип — по расширению (JPEG/PNG или MP4/MOV). */
  media: string[];
  scheduledFor?: string | null;
  timezone?: string | null;
};

export type PublishResult =
  | { ok: true; postId: string; state: PostState }
  | { ok: false; errors: DraftError[] }
  | { ok: false; error: string };

type RawPost = {
  _id?: string;
  id?: string;
  status?: string;
  scheduledFor?: string;
  platforms?: Array<{
    status?: string;
    platformPostUrl?: string;
    errorMessage?: string;
    error?: string;
  }>;
};

const DAY_S = 86_400;
const BUCKET: Record<MediaType, string> = { image: "product-images", video: "product-files" };

async function signedMediaUrl(key: string, type: MediaType, ttlSec: number) {
  const { data } = await serviceDb().storage.from(BUCKET[type]).createSignedUrl(key, ttlSec);
  return data?.signedUrl ?? null;
}

/** Отпечаток публикации: тот же клиент, аккаунты, текст, файлы и время. */
export function publishIdempotencyKey(tenantId: string, input: PublishInput): string {
  const h = sha256Hex(
    JSON.stringify([
      tenantId,
      input.kind,
      [...input.accountIds].sort(),
      input.text,
      input.media,
      input.scheduledFor ?? null,
    ]),
  );
  return `post-${h.slice(0, 40)}`;
}

function firstError(p: RawPost): string | null {
  for (const x of p.platforms ?? []) {
    const e = x.errorMessage || x.error;
    if (e) return e;
  }
  return null;
}

export async function publishPost(
  ctx: TenantContext,
  input: PublishInput,
  now = new Date(),
): Promise<PublishResult> {
  const own = instagramAccounts(ctx)
    .filter((a) => !a.expired)
    .map((a) => a.id);
  if (input.media.some((k) => !isTenantStorageKey(ctx.tenant.id, k)))
    return { ok: false, errors: ["bad_media_url"] };
  const typed = input.media.map((key) => ({ key, type: mediaTypeOf(key) }));
  if (typed.some((m) => !m.type)) return { ok: false, errors: ["bad_media_type"] };

  // Ссылка живёт до публикации и ещё двое суток: Zernio может забрать файл позже.
  const until = input.scheduledFor ? Date.parse(input.scheduledFor) : now.getTime();
  const ttl = Math.max(2 * DAY_S, Math.ceil((until - now.getTime()) / 1000) + 2 * DAY_S);
  const media = [];
  for (const m of typed) {
    const type = m.type!;
    const url = await signedMediaUrl(m.key, type, ttl);
    if (!url) return { ok: false, error: "Файл не найден в хранилище — загрузите его заново." };
    media.push({ type, url });
  }
  const draft = {
    kind: input.kind,
    accountIds: input.accountIds,
    text: input.text,
    media,
    scheduledFor: input.scheduledFor ?? null,
    timezone: input.timezone ?? null,
  };
  const errors = validatePostDraft(draft, own, now);
  if (errors.length) return { ok: false, errors };

  // Повтор той же публикации в течение 10 минут (двойное нажатие, повтор после
  // обрыва связи) отдаёт первую. Idempotency-Key Zernio тут не поможет:
  // подписанные ссылки в теле каждый раз новые.
  const key = publishIdempotencyKey(ctx.tenant.id, input);
  const { data: same, error: sameErr } = await ctx.db
    .from("zernio_logs")
    .select("payload")
    .eq("event_type", "post.created")
    .eq("status", "processed")
    .eq("payload->>key", key)
    .gte("created_at", new Date(now.getTime() - 10 * 60_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (sameErr)
    throw serverFailure(`[zernio] журнал постов не прочитан — пост не создан: ${sameErr.message}`);
  const prevId = (same?.payload as { postId?: string } | null)?.postId;
  if (prevId)
    return { ok: true, postId: prevId, state: input.scheduledFor ? "scheduled" : "publishing" };

  let post: RawPost;
  try {
    const r = await zernioRequest<{ post?: RawPost }>("/posts", {
      method: "POST",
      body: zernioPostBody(draft),
      timeoutMs: 30_000,
    });
    post = r.post ?? {};
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await journal(ctx, `post:${key}:${now.getTime()}`, "failed", input, key, null, error);
    return { ok: false, error };
  }
  const postId = post._id ?? post.id ?? "";
  const state = postState(post.status);
  const error = state === "failed" ? (firstError(post) ?? "Instagram отклонил публикацию") : null;
  await journal(
    ctx,
    postId ? `post:${postId}` : `post:${key}:${now.getTime()}`,
    state === "failed" ? "failed" : "processed",
    input,
    key,
    postId || null,
    error,
  );
  if (state === "failed" || !postId) return { ok: false, error: error ?? "Zernio не вернул пост" };
  return { ok: true, postId, state };
}

async function journal(
  ctx: TenantContext,
  eventId: string,
  status: "processed" | "failed",
  input: PublishInput,
  key: string,
  postId: string | null,
  error: string | null,
) {
  await ctx.db.from("zernio_logs").upsert(
    {
      bot_id: ctx.tenant.id,
      event_id: eventId,
      event_type: "post.created",
      status,
      error_message: error?.slice(0, 500) ?? null,
      payload: {
        key,
        postId,
        kind: input.kind,
        accountIds: input.accountIds,
        text: input.text.slice(0, 300),
        mediaCount: input.media.length,
        scheduledFor: input.scheduledFor ?? null,
      },
    },
    { onConflict: "event_id" },
  );
}

export type PostRow = {
  postId: string | null;
  kind: PostKind;
  text: string;
  accountIds: string[];
  createdAt: string;
  scheduledFor: string | null;
  state: PostState;
  error: string | null;
  url: string | null;
};

type JournalPayload = {
  postId?: string | null;
  kind?: PostKind;
  text?: string;
  accountIds?: string[];
  scheduledFor?: string | null;
};

/** Последние публикации клиента из журнала; статус — свежий из Zernio. */
export async function listOwnPosts(ctx: TenantContext, limit = 20): Promise<PostRow[]> {
  const { data, error: readErr2 } = await ctx.db
    .from("zernio_logs")
    .select("payload, status, error_message, created_at")
    .eq("event_type", "post.created")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (readErr2) throw serverFailure(`[zernio] журнал постов не прочитан: ${readErr2.message}`);
  return Promise.all(
    (data ?? []).map(async (row) => {
      const p = (row.payload ?? {}) as JournalPayload;
      const base: PostRow = {
        postId: p.postId ?? null,
        kind: p.kind ?? "feed",
        text: p.text ?? "",
        accountIds: p.accountIds ?? [],
        createdAt: row.created_at,
        scheduledFor: p.scheduledFor ?? null,
        state: row.status === "failed" ? "failed" : "publishing",
        error: row.error_message,
        url: null,
      };
      if (row.status === "deleted") return { ...base, state: "cancelled" as const };
      if (!base.postId || row.status === "failed") return base;
      try {
        const r = await zernioRequest<{ post?: RawPost }>(
          `/posts/${encodeURIComponent(base.postId)}`,
          {
            timeoutMs: 8000,
          },
        );
        const post = r.post ?? {};
        return {
          ...base,
          state: postState(post.status),
          error: firstError(post),
          url: post.platforms?.find((x) => x.platformPostUrl)?.platformPostUrl ?? null,
        };
      } catch {
        return base;
      }
    }),
  );
}

/** Снять отложенный пост: только свой (есть в журнале клиента). */
export async function cancelScheduledPost(ctx: TenantContext, postId: string): Promise<boolean> {
  const { data, error: readErr } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .eq("event_type", "post.created")
    .eq("event_id", `post:${postId}`)
    .maybeSingle();
  if (readErr) throw serverFailure(`[zernio] пост не найден из-за сбоя чтения: ${readErr.message}`);
  if (!data) return false;
  await zernioRequest(`/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
  await ctx.db
    .from("zernio_logs")
    .update({ status: "deleted", error_message: "снят продавцом" })
    .eq("id", data.id);
  return true;
}
