/** Магазин в WhatsApp через Zernio (whatsapp-purchase.spec.ts): второй аккаунт того же профиля. */
import * as F from "../fixtures.ts";
import type { Row, StubDb } from "../pg-stub.ts";
import { shopBot } from "./util.ts";

export function seedWhatsapp(db: StubDb) {
  const bot = shopBot(db);
  bot.modules = { ...(bot.modules as Row), whatsapp: true, wa_shop: true };
  const settings = bot.settings as Row;
  const zernio = (settings.zernio ?? {}) as Row;
  settings.zernio = {
    ...zernio,
    account_ids: [...((zernio.account_ids as string[]) ?? []), F.WA_ACCOUNT],
    accounts: [
      ...((zernio.accounts as Row[]) ?? []),
      { id: F.WA_ACCOUNT, platform: "whatsapp", username: "+77000000000" },
    ],
  };
}
