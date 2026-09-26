import type { UserError } from "@/core/i18n/user-error";
import { adminErrorText } from "@/app/i18n/user-error";
import { adminLocale } from "./locale.server";

/**
 * Текст UserError на языке админки текущего продавца. Запрос не со страниц
 * админки (панель оператора, в том числе в браузере, где продавец тоже
 * вошёл) или сессии продавца нет — русский текст ошибки.
 */
export async function translateForAdmin(e: UserError): Promise<string> {
  try {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const from = getRequestHeader("referer");
    if (from && !new URL(from).pathname.startsWith("/admin")) return e.message;
    const { requireAdmin } = await import("@/app/auth/guards.server");
    const ctx = await requireAdmin();
    return adminErrorText(await adminLocale(ctx), e);
  } catch {
    return e.message;
  }
}
