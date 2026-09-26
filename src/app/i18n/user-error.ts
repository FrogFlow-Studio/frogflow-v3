import type { Locale } from "@/core/i18n/locale";
import { errorMessage } from "@/lib/error-message";
import { isUserError } from "@/core/i18n/user-error";
import { MODULE_KEYS, type ModuleKey } from "@/core/modules/registry";
import { adminT, isAdminKey } from "./admin";
import { moduleTitleKey } from "./admin/catalog";

/**
 * Текст ошибки на языке админки: UserError с ключом из словаря переводится,
 * остальное — как есть (русский текст ядра или техническая ошибка).
 * Подстановка `{module}` с ключом модуля показывается его названием.
 */
export function adminErrorText(locale: Locale, e: unknown): string {
  if (!isUserError(e) || !isAdminKey(e.key)) return errorMessage(e);
  const t = adminT(locale);
  const vars = { ...e.vars };
  if (typeof vars.module === "string" && (MODULE_KEYS as string[]).includes(vars.module))
    vars.module = t(moduleTitleKey(vars.module as ModuleKey));
  return t(e.key, vars);
}
