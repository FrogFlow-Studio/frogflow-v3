import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimLimitedLog, claimLoginRequest, issueLoginToken } from "./tg-login.server";

/**
 * Запрос ссылки входа владельца. Счёт запросов — на магазин, отдельно от
 * неудачных попыток пароля (admin_login_attempts не трогаем): запросы ссылки
 * не запирают вход паролем, а чужие запросы не засыпают владельца.
 * "limited" — за час уже слали, экран скажет об этом честно. Каждая отправка и
 * первый за час отказ по пределу попадают в журнал действий магазина через
 * `record`: владелец видит, что и откуда просили.
 */
export async function requestTgLogin(
  ctx: TenantContext,
  username: string,
  deliver: (token: string) => Promise<void>,
  record: (result: "sent" | "limited") => Promise<void> = async () => {},
): Promise<"sent" | "limited"> {
  if (!(await claimLoginRequest(ctx))) {
    // Отказы в журнал — не чаще раза в час: поток запросов не должен вытеснять из него действия команды.
    if (await claimLimitedLog(ctx)) await record("limited");
    return "limited";
  }
  await record("sent");
  await deliver(await issueLoginToken(ctx, username));
  return "sent";
}
