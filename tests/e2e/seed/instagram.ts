/** Магазин в Instagram Direct через Zernio (instagram-purchase.spec.ts). */
import * as F from "../fixtures.ts";
import { PIXEL_PNG, type StubDb } from "../pg-stub.ts";
import { shopBot } from "./util.ts";

export function seedInstagram(db: StubDb) {
  const bot = shopBot(db);
  bot.modules = { ...(bot.modules as object), instagram: true, dm_shop: true };
  bot.settings = {
    ...(bot.settings as object),
    zernio: {
      profile_id: F.IG_PROFILE,
      account_ids: [F.IG_ACCOUNT],
      accounts: [{ id: F.IG_ACCOUNT, platform: "instagram", username: "e2e_shop" }],
    },
  };
  // Фото товара: без него Instagram и WhatsApp шлют карточку без картинки.
  db.storage.set(`product-images/${F.SHOP_ID}/propisi.jpg`, { body: PIXEL_PNG, type: "image/png" });
}
