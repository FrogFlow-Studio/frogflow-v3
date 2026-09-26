/**
 * Публикация в Instagram через Zernio: черновик из админки → проверка →
 * тело POST /posts. Без сети и базы — правила Instagram в одном месте
 * (https://docs.zernio.com/platforms/instagram).
 */
export type PostKind = "feed" | "reel" | "story";
export type MediaType = "image" | "video";
export type PostMedia = { type: MediaType; url: string };

export type PostDraft = {
  kind: PostKind;
  accountIds: string[];
  text: string;
  media: PostMedia[];
  /** ISO-время публикации; нет — сейчас. */
  scheduledFor?: string | null;
  timezone?: string | null;
};

export const CAPTION_MAX = 2200;
export const CAROUSEL_MAX = 10;
/** Отложить можно не дальше, чем живёт подписанная ссылка на файл. */
export const SCHEDULE_MAX_DAYS = 30;

export type DraftError =
  | "no_account"
  | "foreign_account"
  | "no_media"
  | "too_many_media"
  | "reel_needs_video"
  | "story_one_media"
  | "caption_too_long"
  | "bad_media_url"
  | "bad_media_type"
  | "schedule_past"
  | "schedule_too_far";

export function mediaTypeOf(nameOrMime: string): MediaType | null {
  const s = nameOrMime.toLowerCase();
  if (/^image\/(jpeg|png)$/.test(s) || /\.(jpe?g|png)$/.test(s)) return "image";
  if (/^video\/(mp4|quicktime)$/.test(s) || /\.(mp4|mov)$/.test(s)) return "video";
  return null;
}

/** Все нарушения черновика; пусто — можно отправлять. */
export function validatePostDraft(
  d: PostDraft,
  ownAccountIds: readonly string[],
  now = new Date(),
): DraftError[] {
  const errors: DraftError[] = [];
  if (d.accountIds.length === 0) errors.push("no_account");
  if (d.accountIds.some((id) => !ownAccountIds.includes(id))) errors.push("foreign_account");
  if (d.media.length === 0) errors.push("no_media");
  if (d.media.some((m) => !/^https:\/\//i.test(m.url))) errors.push("bad_media_url");
  if (d.kind === "feed" && d.media.length > CAROUSEL_MAX) errors.push("too_many_media");
  if (d.kind === "reel" && (d.media.length !== 1 || d.media[0]!.type !== "video"))
    errors.push("reel_needs_video");
  if (d.kind === "story" && d.media.length > 1) errors.push("story_one_media");
  // У сторис подписи нет — текст не уйдёт, но и не мешает.
  if (d.kind !== "story" && d.text.length > CAPTION_MAX) errors.push("caption_too_long");
  if (d.scheduledFor) {
    const at = Date.parse(d.scheduledFor);
    if (Number.isNaN(at) || at < now.getTime() + 60_000) errors.push("schedule_past");
    else if (at > now.getTime() + SCHEDULE_MAX_DAYS * 86_400_000) errors.push("schedule_too_far");
  }
  return errors;
}

/** Тело POST /posts: один элемент platforms на каждый аккаунт клиента. */
export function zernioPostBody(d: PostDraft) {
  const platformSpecificData =
    d.kind === "story"
      ? { contentType: "story" }
      : d.kind === "reel"
        ? // Одиночное видео Instagram публикует как Reels; shareToFeed — показать и в ленте.
          { shareToFeed: true }
        : undefined;
  return {
    ...(d.kind === "story" || !d.text.trim() ? {} : { content: d.text.trim() }),
    mediaItems: d.media.map((m) => ({ type: m.type, url: m.url })),
    platforms: d.accountIds.map((accountId) => ({
      platform: "instagram",
      accountId,
      ...(platformSpecificData ? { platformSpecificData } : {}),
    })),
    ...(d.scheduledFor
      ? { scheduledFor: d.scheduledFor, timezone: d.timezone || "UTC" }
      : { publishNow: true }),
  };
}

export type PostState = "published" | "scheduled" | "publishing" | "failed" | "cancelled";

/** Статус поста Zernio → наш; неизвестное считаем «в процессе». */
export function postState(status: string | undefined | null): PostState {
  switch ((status ?? "").toLowerCase()) {
    case "published":
    case "partial":
      return "published";
    case "scheduled":
      return "scheduled";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "deleted":
      return "cancelled";
    default:
      return "publishing";
  }
}
