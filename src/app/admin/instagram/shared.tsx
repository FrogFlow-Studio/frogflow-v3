import { useRouteContext } from "@tanstack/react-router";
import { instagramFn, instagramPostsFn, postCommentsFn } from "@/app/admin/instagram.functions";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";

/** Общие типы и помощники страницы Instagram. */

export type Data = Awaited<ReturnType<typeof instagramFn>>;

export type Automation = Data["automations"][number];

export type Post = Awaited<ReturnType<typeof instagramPostsFn>>["posts"][number];

export type Button = Automation["buttons"][number];

type CommentRow = Awaited<ReturnType<typeof postCommentsFn>>["comments"][number];

export const REPLY_STATUS: Record<
  CommentRow["replyStatus"],
  { label: AdminKey; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }
> = {
  owner: { label: "instagram.reply.owner", tone: "neutral" },
  sent: { label: "instagram.reply.sent", tone: "ok" },
  failed: { label: "instagram.reply.failed", tone: "danger" },
  no_match: { label: "instagram.reply.no_match", tone: "neutral" },
  no_automation: { label: "instagram.reply.no_automation", tone: "neutral" },
  missing: { label: "instagram.reply.missing", tone: "warn" },
};

export const BLOCK_REASON: Record<string, AdminKey> = {
  nested: "instagram.block.nested",
  too_old: "instagram.block.too_old",
  cannot_reply: "instagram.block.cannot_reply",
};

/** Переводчик и код Intl для языка панели — из контекста маршрута. */
export function useAdminI18n() {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  return { t: adminT(shop.locale), intl: intlLocale(shop.locale) };
}

/** Что открыто в форме правила: новое, правка или копия существующего. */
export type EditTarget =
  { kind: "new" } | { kind: "edit"; rule: Automation } | { kind: "copy"; rule: Automation };

export type Editing = EditTarget & { key: number };

/** Якорь правила в списке — для прокрутки к нему после сохранения. */
export const ruleAnchor = (id: string) => `ig-rule-${id}`;

/** Плавная прокрутка, если пользователь не просил убрать анимацию. */
export function scrollToEl(el: Element | null, block: ScrollLogicalPosition) {
  if (!el) return;
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block });
}
