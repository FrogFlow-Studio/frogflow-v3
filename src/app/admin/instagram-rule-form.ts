import { DEFAULT_REPLY_PROMPT } from "@/core/instagram/comment-rules";

/**
 * Начальные значения формы правила Comment-to-DM (страница Instagram в
 * админке): новое правило, «Изменить» и «Скопировать». Чистые функции без
 * React — их проверяет instagram-rule-form.test.ts.
 */

export type RuleButton = {
  type: "url" | "postback";
  title: string;
  url?: string;
  payload?: string;
};

/** Правило, как его отдаёт instagramFn (только поля, нужные форме). */
export type RuleSource = {
  id: string;
  accountId: string;
  name: string;
  trigger: "comment" | "story_reply";
  platformPostId: string | null;
  postId: string | null;
  postTitle: string;
  keywords: string[];
  matchMode: "exact" | "contains";
  dmMessage: string;
  buttons: RuleButton[];
  commentReply: string;
  commentReplyVariations: string[];
  twoStepDm: boolean;
  secondDmMessage: string;
  unresolvedPrompt: string;
  replyPrompt: string | null;
};

export type RuleTarget = { platformPostId: string; postId: string; title: string };

export type RuleFormValues = {
  accountId: string;
  name: string;
  trigger: "comment" | "story_reply";
  target: RuleTarget | null;
  keywords: string;
  replyToAll: boolean;
  matchMode: "exact" | "contains";
  dmMessage: string;
  buttons: RuleButton[];
  /** Публичный ответ: основной и варианты (Zernio чередует их). */
  commentReplies: string[];
  twoStepDm: boolean;
  secondDmMessage: string;
  unresolvedPrompt: string;
  replyPrompt: string;
};

/** Предел длины названия правила в форме (maxLength у поля). */
export const RULE_NAME_MAX = 120;

/** Значения формы: пустые для нового правила или из правила для «Изменить». */
export function ruleFormValues(rule: RuleSource | null, defaultAccountId: string): RuleFormValues {
  const replies = [rule?.commentReply ?? "", ...(rule?.commentReplyVariations ?? [])];
  return {
    accountId: rule?.accountId ?? defaultAccountId,
    name: rule?.name ?? "",
    trigger: rule?.trigger ?? "comment",
    target: rule?.platformPostId
      ? {
          platformPostId: rule.platformPostId,
          postId: rule.postId ?? "",
          title: rule.postTitle,
        }
      : null,
    keywords: rule?.keywords.join(", ") ?? "",
    replyToAll: Boolean(rule && rule.keywords.length === 0),
    matchMode: rule?.matchMode ?? "contains",
    dmMessage: rule?.dmMessage ?? "",
    buttons: (rule?.buttons ?? []).map((b) => ({ ...b })),
    commentReplies: replies.filter((r, i) => i === 0 || r.trim()),
    twoStepDm: rule?.twoStepDm ?? false,
    secondDmMessage: rule?.secondDmMessage ?? "",
    unresolvedPrompt: rule?.unresolvedPrompt ?? "",
    replyPrompt: rule?.replyPrompt ?? DEFAULT_REPLY_PROMPT,
  };
}

/**
 * «Скопировать правило»: форма нового правила с текстами, кнопками,
 * вариантами ответа и настройками исходного, но без поста — пост выбирают
 * заново (у Кристины правила к разным видео отличаются только постом).
 * `copyName` даёт название с пометкой копии на языке панели; результат
 * укорачиваем до предела поля, чтобы форму можно было сохранить сразу.
 */
export function copyRuleFormValues(
  rule: RuleSource,
  copyName: (name: string) => string,
): RuleFormValues {
  const base = ruleFormValues(rule, rule.accountId);
  // Укорачиваем исходное название, а не пометку: «(копия)» должна остаться видна.
  const overflow = copyName(rule.name).length - RULE_NAME_MAX;
  const name =
    overflow > 0
      ? copyName(rule.name.slice(0, Math.max(0, rule.name.length - overflow))).slice(
          0,
          RULE_NAME_MAX,
        )
      : copyName(rule.name);
  return { ...base, name, target: null };
}

/** Есть ли в форме несохранённые изменения относительно начальных значений. */
export function ruleFormDirty(current: RuleFormValues, initial: RuleFormValues): boolean {
  return JSON.stringify(current) !== JSON.stringify(initial);
}
