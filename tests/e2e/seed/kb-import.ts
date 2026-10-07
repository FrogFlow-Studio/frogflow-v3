/**
 * Статьи базы знаний, оставшиеся от v1 под чужим bot_id (его нет в `bots`):
 * оператор переносит их клиенту-консультанту (kb-import.spec.ts).
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add } from "./util.ts";

export function seedKbImport(db: StubDb, now: string) {
  add(db, "app_settings", [
    {
      bot_id: F.KB_IMPORT_SOURCE_ID,
      key: "consultant_knowledge_json",
      value: JSON.stringify([
        {
          id: "kb-v1-1",
          title: F.KB_IMPORT_TITLE,
          tags: ["фабрика"],
          content: "Полотенца и бельё шьют в Португалии и Турции.",
          updatedAt: now,
        },
        {
          id: "kb-v1-2",
          title: "Уход за махрой из v1",
          tags: ["уход"],
          content: "Стирка при 40 градусах, без кондиционера.",
          updatedAt: now,
        },
        {
          id: "kb-v1-3",
          title: "Доставка из v1",
          tags: ["доставка"],
          content: "По Алматы — бесплатно от 30 000 ₸.",
          updatedAt: now,
        },
      ]),
      updated_at: now,
    },
  ]);
}
