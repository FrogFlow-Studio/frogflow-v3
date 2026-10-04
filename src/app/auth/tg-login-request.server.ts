import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimLoginRequest, issueLoginToken } from "./tg-login.server";

/**
 * Запрос ссылки входа владельца. Счёт запросов — на магазин, отдельно от
 * неудачных попыток пароля (admin_login_attempts не трогаем): запросы ссылки
 * не запирают вход паролем, а чужие запросы не засыпают владельца.
 * "limited" — за час уже слали, экран скажет об этом честно.
 */
export async function requestTgLogin(
  ctx: TenantContext,
  username: string,
  deliver: (token: string) => Promise<void>,
): Promise<"sent" | "limited"> {
  if (!(await claimLoginRequest(ctx))) return "limited";
  await deliver(await issueLoginToken(ctx, username));
  return "sent";
}
