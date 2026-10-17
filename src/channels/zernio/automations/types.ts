import type { Json } from "@/core/db-types";
import type { AutomationButton, MatchMode } from "@/core/instagram/comment-rules";
import type { sendInboxMessage } from "../api.server";
import type { ZernioInboxMessage } from "../inbox-types";
import type {
  annotateCommentStatus,
  commentPrivateReplyBlockReason,
} from "@/core/instagram/comment-rules";

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

/** Чтение комментариев прервано по бюджету времени: неполный список использовать нельзя (дубль DM тем, кто уже получил). */
export class CommentsStopped extends Error {
  constructor() {
    super("чтение комментариев прервано: бюджет времени крона");
    this.name = "CommentsStopped";
  }
}

export type AnnotatedComment = InstagramComment & {
  replyStatus: ReturnType<typeof annotateCommentStatus>;
  blockReason: ReturnType<typeof commentPrivateReplyBlockReason>;
};

import type { TenantContext } from "@/core/tenant/resolve.server";

export const automationId = (a: { id?: string; _id?: string }): string =>
  String(a.id || a._id || "");

export function ownsZernioAccount(ctx: TenantContext, accountId: string): boolean {
  const z = ctx.tenant.settings.zernio;
  return Boolean(
    z?.accounts?.some((a) => a.id === accountId) || z?.account_ids?.includes(accountId),
  );
}
