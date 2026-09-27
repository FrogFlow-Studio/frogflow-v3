import type { TenantContext } from "@/core/tenant/resolve.server";
import { rateLimiter, takeShared, type Budget } from "@/core/storefront/rate-limit";

/**
 * Частота вызовов модели консультантом. Дневной предел в долларах (budget.ts)
 * бережёт деньги клиента за сутки, а этот — от всплеска: сотня сообщений в
 * минуту (рассылка, спам, петля) не должна за минуту выжечь дневной предел
 * и упереться в лимиты ключа Anthropic платформы. Считается КАЖДЫЙ вызов API,
 * то есть каждый раунд с инструментами и попытка переписать черновик.
 *
 * - на клиента — общий счёт всех экземпляров функции (takeShared, app_settings);
 * - на платформу — счёт в памяти экземпляра: общей строки на всю платформу
 *   без схемы нет, а один экземпляр — это и есть точка, которая бьёт в ключ.
 */
export const CLIENT_CALLS: Budget = { limit: 60, windowMs: 60_000 };
export const PLATFORM_CALLS: Budget = { limit: 600, windowMs: 60_000 };

const platform = rateLimiter(4);

export async function takeAiCall(ctx: TenantContext, now = Date.now()): Promise<boolean> {
  if (!platform.take("consultant", PLATFORM_CALLS, now)) return false;
  return takeShared(ctx, "consultant_ai", "calls", CLIENT_CALLS);
}
