import { telegramApi } from "@/channels/telegram/api";
import { serverFailure } from "@/lib/server-failure";
import { sendInboxMessage } from "@/channels/zernio/api.server";
import { env } from "@/config/env";
import { serviceDb, tenantDb } from "@/core/db/client.server";
import { adminRecipients } from "@/core/notify/recipients";
import { storefrontBase } from "@/core/tenant/custom-domain";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { parkedAgentModel } from "../agent/model";
import { postgrestV4Db, type RpcClient } from "../core/db";
import { adaptComment, adaptDirect, adaptTelegram, zernioIntent } from "./adapt";
import { outboundOf, sendOnce, type Outbound } from "./reply";
import { sendTelegramCard, zernioOutcome } from "./senders.server";

/**
 * Ветка вебхука для магазина с served_by = v4. Модель припаркована: текст
 * не уходит в API. База — роль арендатора этого магазина. Схема v4 не
 * открыта — ошибка «не подключена», маршрут отвечает 503. Заявку v3 этот
 * файл не ставит. Отправка одна: unknown не повторяется.
 */

const SCHEMA = /schema must be one of|PGRST106/i;

function db(botId: string) {
  return postgrestV4Db(tenantDb(botId) as unknown as RpcClient);
}

function walletDb() {
  return postgrestV4Db(serviceDb() as unknown as RpcClient);
}

async function sellerChats(ctx: TenantContext): Promise<string[]> {
  try {
    return await adminRecipients(ctx);
  } catch {
    return [];
  }
}

function telegramSend(
  ctx: TenantContext,
): ((message: Outbound) => Promise<"sent" | "failed" | "unknown">) | null {
  let token = "";
  try {
    token = ctx.secrets.telegramToken();
  } catch {
    return null;
  }
  if (!token) return null;
  const api = telegramApi(token, env().TELEGRAM_API_BASE);
  return async (message) => sendTelegramCard(api, message);
}

export async function dispatchV4Telegram(botId: string, update: unknown, tenant: Tenant) {
  const id = (update as { update_id?: number }).update_id;
  if (id == null) return { kind: "ignore" as const };
  const { tenantContext } = await import("@/core/tenant/resolve.server");
  const ctx = tenantContext(tenant);
  const chats = await sellerChats(ctx);
  const send = telegramSend(ctx);
  const { downloadTelegramFile } = await import("@/channels/telegram/update/payments");
  let token = "";
  try {
    token = ctx.secrets.telegramToken();
  } catch {
    token = "";
  }
  const api = token ? telegramApi(token, env().TELEGRAM_API_BASE) : null;
  try {
    const result = await adaptTelegram(db(botId), {
      botId,
      update: update as Parameters<typeof adaptTelegram>[1]["update"],
      claimId: `tg:${id}`,
      model: parkedAgentModel,
      mode: "live",
      walletDb: walletDb(),
      sellerChatIds: chats,
      ...(api
        ? {
            loadFile: async (fileId: string) =>
              (await downloadTelegramFile(api, fileId))?.bytes ?? null,
            saveFile: async (path: string, bytes: Uint8Array) => {
              const up = await serviceDb()
                .storage.from("payment-proofs")
                .upload(path, bytes, { contentType: "application/octet-stream", upsert: false });
              if (up.error) throw serverFailure(up.error.message);
            },
          }
        : {}),
    });
    const chat = chatOf(update);
    const shop =
      tenant.modules.telegram_mini_app && tenant.modules.shop
        ? storefrontBase(tenant, ctx.appUrl)
        : undefined;
    if (send && chat) await sendOnce(send, outboundOf(result, chat, "ru", shop));
    return result;
  } catch (e) {
    if (e instanceof Error && SCHEMA.test(e.message)) throw new Error("v4 not connected");
    throw e;
  }
}

function chatOf(update: unknown): string | null {
  const u = update as {
    message?: { chat?: { id?: number | string } };
    callback_query?: { message?: { chat?: { id?: number | string } } };
  };
  const id = u.callback_query?.message?.chat?.id ?? u.message?.chat?.id;
  return id == null ? null : String(id);
}

export async function dispatchV4Zernio(botId: string, payload: unknown, tenant: Tenant) {
  const body = payload as Parameters<typeof zernioIntent>[0] & {
    message?: { conversationId?: string; text?: string };
    account?: { accountId?: string; id?: string };
  };
  const intent = zernioIntent(body);
  if (intent.type === "ignore") return { kind: "ignore" as const };
  const claimId =
    body.id ??
    (intent.type === "comment"
      ? `comment:${intent.externalId}`
      : `${intent.type}:${intent.externalId}`);
  if (tenant.id !== botId) throw new Error("v4 not connected");
  try {
    const result =
      intent.type === "comment"
        ? await adaptComment(db(botId), {
            botId,
            claimId,
            externalId: intent.externalId,
            postId: intent.postId,
            commenterId: intent.commenterId,
            text: intent.text,
            commentedAt: new Date(),
          })
        : await adaptDirect(db(botId), {
            botId,
            channel: intent.channel,
            claimId,
            externalId: intent.externalId,
            text: intent.type === "text" ? intent.text : "",
            mode: "live",
            walletDb: walletDb(),
            ...(intent.type === "buy" ? { productId: intent.productId } : {}),
            ...(intent.type === "offer" ? { offerId: intent.offerId } : {}),
            model: parkedAgentModel,
          });
    if (intent.type !== "comment") {
      const conversationId = body.message?.conversationId;
      const accountId = body.account?.accountId || body.account?.id;
      const out = outboundOf(result, intent.externalId);
      if (out && conversationId && accountId) {
        await sendOnce(async (message) => {
          const sent = await sendInboxMessage(conversationId, accountId, message.text, {
            platform: intent.channel,
            idempotencyScope: "v4",
            ...(message.photoUrl
              ? { attachmentUrl: message.photoUrl, attachmentType: "image" as const }
              : {}),
            buttons: message.buttons
              .filter((b) => !b.webAppUrl)
              .slice(0, 3)
              .map((b) => ({ type: "postback" as const, title: b.label, payload: b.data })),
          });
          return zernioOutcome(sent);
        }, out);
      }
    }
    return result;
  } catch (e) {
    if (e instanceof Error && SCHEMA.test(e.message)) throw new Error("v4 not connected");
    throw e;
  }
}
