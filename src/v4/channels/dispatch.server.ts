import { serviceDb } from "@/core/db/client.server";
import { parkedAgentModel } from "../agent/model";
import { postgrestV4Db, type RpcClient } from "../core/db";
import { adaptComment, adaptDirect, adaptTelegram, zernioIntent } from "./adapt";

/**
 * Ветка вебхука для магазина с served_by = v4. Модель припаркована: текст
 * не уходит в API. Схема v4 не открыта — ошибка «не подключена», маршрут
 * отвечает 503, чтобы Telegram и Zernio повторили, а не потеряли событие.
 * Заявку v3 этот файл не ставит.
 */

const SCHEMA = /schema must be one of|PGRST106/i;

function db() {
  return postgrestV4Db(serviceDb() as unknown as RpcClient);
}

export async function dispatchV4Telegram(botId: string, update: unknown) {
  const id = (update as { update_id?: number }).update_id;
  if (id == null) return { kind: "ignore" as const };
  try {
    return await adaptTelegram(db(), {
      botId,
      update: update as Parameters<typeof adaptTelegram>[1]["update"],
      claimId: `tg:${id}`,
      model: parkedAgentModel,
      mode: "test",
    });
  } catch (e) {
    if (e instanceof Error && SCHEMA.test(e.message)) throw new Error("v4 not connected");
    throw e;
  }
}

export async function dispatchV4Zernio(botId: string, payload: unknown) {
  const body = payload as Parameters<typeof zernioIntent>[0];
  const intent = zernioIntent(body);
  if (intent.type === "ignore") return { kind: "ignore" as const };
  const claimId =
    body.id ??
    (intent.type === "comment"
      ? `comment:${intent.externalId}`
      : `${intent.type}:${intent.externalId}`);
  try {
    if (intent.type === "comment") {
      return await adaptComment(db(), {
        botId,
        claimId,
        externalId: intent.externalId,
        postId: intent.postId,
        commenterId: intent.commenterId,
        text: intent.text,
        commentedAt: new Date(),
      });
    }
    return await adaptDirect(db(), {
      botId,
      channel: intent.channel,
      claimId,
      externalId: intent.externalId,
      text: intent.type === "text" ? intent.text : "",
      ...(intent.type === "buy" ? { productId: intent.productId } : {}),
      model: parkedAgentModel,
    });
  } catch (e) {
    if (e instanceof Error && SCHEMA.test(e.message)) throw new Error("v4 not connected");
    throw e;
  }
}
