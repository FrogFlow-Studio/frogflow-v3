import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingStrict, setSetting } from "@/core/settings/settings";

/**
 * Текст по умолчанию для нового правила Comment-to-DM: продавец пишет одно и
 * то же сообщение к каждому видео и меняет только название и цену («Кнопка
 * для видео», 15.11). Сохраняется кнопкой в форме правила, подставляется в
 * форму нового правила; уже созданные правила не трогает.
 */
export const RULE_TEMPLATE_KEY = "instagram_rule_template";

export type RuleTemplate = { dmMessage: string; secondDmMessage: string };

export const EMPTY_RULE_TEMPLATE: RuleTemplate = { dmMessage: "", secondDmMessage: "" };

/** Разбор сохранённого значения; мусор и чужой формат — пустой шаблон. */
export function parseRuleTemplate(raw: string | null): RuleTemplate {
  if (!raw) return EMPTY_RULE_TEMPLATE;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof RuleTemplate, unknown>>;
    return {
      dmMessage: typeof v.dmMessage === "string" ? v.dmMessage : "",
      secondDmMessage: typeof v.secondDmMessage === "string" ? v.secondDmMessage : "",
    };
  } catch {
    return EMPTY_RULE_TEMPLATE;
  }
}

/** Сбой чтения — ошибка, а не «шаблона нет»: иначе форма молча открылась бы пустой. */
export async function loadRuleTemplate(ctx: TenantContext): Promise<RuleTemplate> {
  return parseRuleTemplate(await getSettingStrict(ctx, RULE_TEMPLATE_KEY));
}

export async function saveRuleTemplate(ctx: TenantContext, t: RuleTemplate): Promise<void> {
  await setSetting(
    ctx,
    RULE_TEMPLATE_KEY,
    JSON.stringify({ dmMessage: t.dmMessage.trim(), secondDmMessage: t.secondDmMessage.trim() }),
  );
}
