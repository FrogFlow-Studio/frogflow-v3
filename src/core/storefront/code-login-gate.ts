import type { TenantContext } from "@/core/tenant/resolve.server";
import { storefrontOpen } from "./access";
import { webCheckoutSettings } from "./web-order";

/**
 * Вход по коду открыт: клиент на v2, на витрине включено оформление с сайта и
 * вход покупателей (тот же выключатель, что у входа через Telegram). Клиента
 * прежней платформы сюда не пускает `storefrontOpen` (servedByV2).
 */
export async function codeLoginOpen(ctx: TenantContext): Promise<boolean> {
  if (!storefrontOpen(ctx.tenant, "web_checkout")) return false;
  const s = await webCheckoutSettings(ctx);
  return s.enabled && s.tgLogin;
}
