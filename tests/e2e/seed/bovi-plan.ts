/** Консультант без тарифной сетки (bovi-plan.spec.ts): плана нет, уже на v2. */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add, encrypt } from "./util.ts";

export function seedBoviPlan(db: StubDb, now: string) {
  add(db, "bots", [
    {
      id: F.BOVI_PLAN_ID,
      bot_name: F.BOVI_PLAN_NAME,
      status: "active",
      vertical: "consultant",
      modules: { instagram: true, shop: true },
      settings: { served_by: "v2", default_locale: "ru" },
      paused_message: null,
      owner_telegram_id: 500000231,
      owner_name: "Консультант без плана",
      app_url: null,
      archived_at: null,
      bot_token: encrypt("700000231:E2E-bovi-plan-token", F.SECRETS_KEY),
      subscription_plan: null,
      subscription_expires_at: null,
      created_at: now,
    },
  ]);
}
