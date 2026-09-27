/**
 * Comment-to-DM в Instagram (comment-to-dm.spec.ts). Правило v2: кнопок у
 * Zernio нет, первое сообщение просит ответить «+», кнопки второго шага — в
 * мете. Правило v1: кнопки лежат у самого правила, меты нет — v2 переводит
 * его в два шага при первом чтении.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";

export function seedCommentToDm(db: StubDb, now: string) {
  const catalogButton = [{ type: "postback", title: "📚 Каталог", payload: "CATALOG" }];
  const rule = { trigger: "comment", accountId: F.IG_ACCOUNT, profileId: F.IG_PROFILE };
  db.zernioAutomations.push(
    {
      ...rule,
      id: F.RULE_V2,
      name: "Хочу",
      keywords: [F.RULE_V2_KEYWORD],
      matchMode: "contains",
      dmMessage: "Спасибо за комментарий!\n\nОтветьте «+» в этот чат, и я пришлю ссылку 👇",
      buttons: [],
      isActive: true,
    },
    {
      ...rule,
      id: F.RULE_V1,
      name: "Прописи",
      keywords: [F.RULE_V1_KEYWORD],
      matchMode: "contains",
      dmMessage: "Держите каталог",
      buttons: catalogButton,
      isActive: true,
    },
  );
  (db.tables.app_settings ??= []).push({
    bot_id: F.SHOP_ID,
    key: "ig_comment_automations_meta",
    value: JSON.stringify({
      [F.RULE_V2]: {
        twoStepDm: true,
        secondDmMessage: "Вот каталог — выбирайте 👇",
        secondDmButtons: catalogButton,
      },
    }),
    updated_at: now,
  });
}
