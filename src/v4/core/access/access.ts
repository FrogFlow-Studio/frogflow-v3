import { createHash, randomBytes } from "node:crypto";
import { serverFailure } from "@/lib/server-failure";
import { attempt, type V4Db, type V4Result } from "../db";

/**
 * Выдача и доступы v4 (этап 3). Логика — в migrations/v4/004-access.sql:
 * оплаченный заказ сам выдаёт доступ один раз и ставит задачи выдачи; здесь
 * типы, итог выдачи, отзыв и кабинет покупателя по ссылке.
 */

export const ACCESS_KINDS = ["file", "club"] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number];
export const ACCESS_STATUSES = ["active", "expired", "revoked"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];
export const DELIVERY_CHANNELS = ["telegram", "instagram", "whatsapp", "email"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

type Row = Record<string, unknown>;
const one = (rows: Row[], fn: string): Row => {
  const r = rows[0];
  if (!r) throw serverFailure(`v4.${fn}: пустой ответ`);
  return r;
};

/**
 * Итог выдачи по каналу. unknown — обрыв, тайм-аут, 5xx: могло дойти, повторять
 * нельзя. Неудача и неизвестность открывают дело «сбой выдачи». false — итог по
 * этому каналу уже записан раньше.
 */
export function deliveryResult(
  db: V4Db,
  input: {
    botId: string;
    accessId: string;
    channel: DeliveryChannel;
    status: "sent" | "failed" | "unknown";
    error?: string;
  },
): Promise<V4Result<boolean>> {
  return attempt(async () =>
    Boolean(
      one(
        await db.call("delivery_result", {
          p_bot_id: input.botId,
          p_access_id: input.accessId,
          p_channel: input.channel,
          p_status: input.status,
          p_error: input.error ?? null,
        }),
        "delivery_result",
      ).delivery_result,
    ),
  );
}

export function revokeAccess(
  db: V4Db,
  input: { botId: string; accessId: string; reason: string; by: string },
): Promise<V4Result<boolean>> {
  return attempt(async () =>
    Boolean(
      one(
        await db.call("revoke_access", {
          p_bot_id: input.botId,
          p_access_id: input.accessId,
          p_reason: input.reason,
          p_created_by: input.by,
        }),
        "revoke_access",
      ).revoke_access,
    ),
  );
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Ссылка в кабинет (решение 12): токен уходит покупателю, в базе только его sha256. */
export async function issueCabinetLink(
  db: V4Db,
  botId: string,
  buyerId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(24).toString("base64url");
  const r = one(
    await db.call("issue_cabinet_link", {
      p_bot_id: botId,
      p_buyer_id: buyerId,
      p_token_sha256: sha256(token),
    }),
    "issue_cabinet_link",
  );
  return { token, expiresAt: new Date(r.issue_cabinet_link as string) };
}

export type CabinetItem = {
  accessId: string;
  title: string;
  variantLabel: string | null;
  kind: AccessKind;
  endsAt: Date | null;
  storagePath: string | null;
};

/** Что видит покупатель по ссылке. Неверная или старая ссылка — пустой список. */
export async function cabinetItems(db: V4Db, botId: string, token: string): Promise<CabinetItem[]> {
  const rows = await db.call("cabinet_items", { p_bot_id: botId, p_token_sha256: sha256(token) });
  return rows.map((r) => ({
    accessId: String(r.access_id),
    title: String(r.title),
    variantLabel: (r.variant_label as string | null) ?? null,
    kind: r.kind as AccessKind,
    endsAt: r.ends_at ? new Date(r.ends_at as string) : null,
    storagePath: (r.storage_path as string | null) ?? null,
  }));
}
