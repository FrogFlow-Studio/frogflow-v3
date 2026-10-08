import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { servedByV2 } from "@/core/tenant/directory";
import { customerFromRow, USER_KEY_PREFIX, type Customer } from "@/core/customers/customers";
import { runNotingEffects } from "@/lib/external-effects";
import { inChunks } from "@/lib/in-chunks";
import { scrubForLog } from "@/lib/log-mask";
import type { ZernioConversation, ZernioTransport } from "./api.server";
import type { DispatchOutcome } from "./dispatch.server";
import { keyRateLimitSec } from "./errors";
import type { ZernioInboxMessage } from "./inbox-types";
import {
  MAX_AGE_MS,
  missedIncoming,
  personReplyAfter,
  pollEventId,
  zernioMessageKeys,
} from "./inbox-poll";
import type { ZernioWebhookMessagePayload } from "./message";
import { isZernioPlatform, type ZernioPlatform } from "./platform";

/**
 * Опрос ящика Zernio по одному клиенту (крон inbox-poll, раз в минуту).
 * Решение «отвечать ли» — inbox-poll.ts; здесь чтение Zernio и базы и
 * передача сообщения тому же обработчику, что у вебхука (dispatch →
 * handle-message): пауза, менеджер в чате, голосовое, фото, сторис и
 * журнал ответов ведут себя одинаково. Сообщение получает строку журнала
 * `poll:<bot>:<id>` (видна оператору во «Входящих» с итогом «опрос: …»), а
 * обработчик ставит метку сообщения (message-claim.server): опрос и поздний
 * вебхук одно сообщение дважды не обработают.
 *
 * Границы: диалогов на аккаунт за запуск — MAX_CONVERSATIONS, лишние
 * считаются в `over_cap` и ждут следующей минуты; у каждого чтения Zernio —
 * тайм-аут (api.server), у клиента — срок `deadline`; 429 Zernio (лимит на
 * весь ключ) останавливает опрос, а крон — остальных клиентов.
 */
export const MAX_CONVERSATIONS = 10;

export type InboxPollDeps = {
  listConversations: (accountId: string, platform: ZernioPlatform) => Promise<ZernioConversation[]>;
  transport: ZernioTransport;
  dispatch: (
    ctx: TenantContext,
    eventId: string,
    payload: ZernioWebhookMessagePayload,
    transport: ZernioTransport,
  ) => Promise<DispatchOutcome>;
  consultantEnabled: (ctx: TenantContext) => Promise<boolean>;
  /** Размер страницы списка диалогов: полная страница — свежих могло быть больше. */
  page: number;
};

export type InboxPollResult = {
  accounts: number;
  /** Свежих диалогов в списках Zernio. */
  conversations: number;
  /** Сколько переписок прочитано. */
  checked: number;
  /** Отдано обработчику (processed). */
  answered: number;
  /** Почему не отвечали — счётчики по причинам. */
  skipped: Record<string, number>;
  /** Свежие диалоги сверх MAX_CONVERSATIONS — на следующий запуск. */
  over_cap: number;
  /** Список занял всю страницу: свежих могло быть больше, чем видно. */
  page_full?: number;
  /** Не уложились в срок — не прочитано в этот запуск. */
  deferred: number;
  errors: string[];
  /** Zernio ответил 429: пробовать снова через столько секунд. */
  rateLimitedSec?: number;
  /** Задач консультанта, закрытых ответом менеджера прямо в приложении. */
  tasks_closed?: number;
};

export type InboxPollSkip = { skipped: string };

type Account = { id: string; platform: ZernioPlatform };

/** Аккаунты клиента, которые слушает опрос: Instagram/WhatsApp с включённым модулем. */
export function pollAccounts(tenant: Tenant): Account[] {
  const z = tenant.settings.zernio;
  const ids = z?.account_ids?.length ? new Set(z.account_ids) : null;
  return (z?.accounts ?? [])
    .filter((a) => a.id && !a.expired && (!ids || ids.has(a.id)))
    .filter((a): a is typeof a & { platform: ZernioPlatform } => isZernioPlatform(a.platform))
    .filter((a) => tenant.modules[a.platform])
    .map((a) => ({ id: a.id, platform: a.platform }));
}

function memoryOf(c: Customer | undefined, now: number) {
  const s = c?.state.consultant;
  const m = (s && typeof s === "object" && !Array.isArray(s) ? s : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const until = Date.parse(str(m.paused_until) ?? "");
  return {
    paused: Number.isFinite(until) && until > now,
    resumedAt: str(m.resumed_at),
    lastReplyAt: str(m.last_reply_at),
  };
}

/**
 * Открытые задачи консультанта (core/consultant/tasks): покупатель → время
 * самой старой открытой. Только консультанту по прайсу; сбой чтения — пусто
 * (задачи закроются на следующем запуске или следующем сообщении).
 */
async function openTaskSince(ctx: TenantContext): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { pricelistMode } = await import("@/core/consultant/pricelist/mode");
  if (!pricelistMode(ctx.tenant)) return out;
  const { loadTasks } = await import("@/core/consultant/tasks");
  const tasks = await loadTasks(ctx).catch((e: unknown) => {
    console.warn(`[inbox-poll:${ctx.tenant.id}] задачи не прочитаны: ${String(e)}`);
    return [];
  });
  for (const t of tasks) {
    if (t.done) continue;
    const prev = out.get(t.userKey);
    if (!prev || t.at < prev) out.set(t.userKey, t.at);
  }
  return out;
}

/** Наши ответы в диалоге: бот, пересланное из Telegram — не ответ человека. */
function ourReplies(c: Customer): string[] {
  const s = c.state.consultant;
  const m = (s && typeof s === "object" && !Array.isArray(s) ? s : {}) as {
    recent?: Array<{ role: string; text: string }>;
    relayed?: string[];
  };
  const direct = c.state.direct as { last_reply?: string } | undefined;
  return [
    ...(Array.isArray(m.recent) ? m.recent : [])
      .filter((t) => t.role === "assistant")
      .map((t) => t.text),
    ...(Array.isArray(m.relayed) ? m.relayed : []),
    ...(typeof direct?.last_reply === "string" ? [direct.last_reply] : []),
  ];
}

/** Покупатель по id диалога — тот же, кого записал вебхук; не второй ключ по username. */
async function customersByConversation(
  ctx: TenantContext,
  ids: string[],
): Promise<Map<string, Customer>> {
  const out = new Map<string, Customer>();
  if (!ids.length) return out;
  const rows = await inChunks(
    ids,
    (chunk) =>
      ctx.db
        .from("bot_users")
        .select("*")
        .in("zernio_conversation_id", chunk)
        .order("updated_at", { ascending: false })
        .order("user_key"),
    "[inbox-poll] покупатели не прочитаны",
  );
  for (const row of rows) {
    const c = customerFromRow(row);
    // Новее — первым (сортировка): дубль покупателя на тот же диалог не перебивает.
    if (c.zernioConversationId && !out.has(c.zernioConversationId))
      out.set(c.zernioConversationId, c);
  }
  return out;
}

/** Id собеседника: из своего покупателя по диалогу, иначе из сообщения или диалога Zernio. */
function senderIdOf(
  platform: ZernioPlatform,
  customer: Customer | undefined,
  msg: ZernioInboxMessage,
  convo: ZernioConversation,
): string | null {
  const prefix = USER_KEY_PREFIX[platform];
  if (customer?.userKey.startsWith(prefix)) return customer.userKey.slice(prefix.length);
  return msg.sender?.id || convo.participantId || null;
}

/** Событие message.received из сообщения ящика — в той форме, что разбирает parseZernioMessage. */
export function pollPayload(p: {
  eventId: string;
  account: Account;
  convo: ZernioConversation;
  msg: ZernioInboxMessage;
  senderId: string;
}): ZernioWebhookMessagePayload {
  const { msg, convo, account } = p;
  return {
    id: p.eventId,
    event: "message.received",
    timestamp: msg.createdAt,
    message: {
      id: msg.id,
      ...(msg.platformMessageId ? { platformMessageId: msg.platformMessageId } : {}),
      conversationId: convo.id,
      platform: account.platform,
      direction: "incoming",
      text: msg.message ?? null,
      ...(msg.attachments ? { attachments: msg.attachments } : {}),
      ...(msg.metadata ? { metadata: msg.metadata } : {}),
      sender: { ...(msg.sender ?? {}), id: p.senderId },
      sentAt: msg.createdAt,
    },
    conversation: {
      id: convo.id,
      ...(convo.participantId ? { participantId: convo.participantId } : {}),
      ...(convo.participantName ? { participantName: convo.participantName } : {}),
      ...(convo.participantUsername ? { participantUsername: convo.participantUsername } : {}),
    },
    account: { accountId: account.id, platform: account.platform },
  };
}

class RateLimited extends Error {
  constructor(readonly sec: number) {
    super("zernio rate limit");
  }
}

export async function pollTenantInbox(
  ctx: TenantContext,
  deps: InboxPollDeps,
  opts: { now?: number; deadline?: number } = {},
): Promise<InboxPollResult | InboxPollSkip> {
  const t = ctx.tenant;
  // Клиент прежней платформы для v2 невидим: его ящик отвечает v1 (CLAUDE.md, п. 6).
  if (!servedByV2(t)) return { skipped: "not v2" };
  if (t.status !== "active") return { skipped: "tenant not active" };
  const accounts = pollAccounts(t);
  if (!accounts.length) return { skipped: "no accounts" };
  if (!(await deps.consultantEnabled(ctx))) return { skipped: "consultant off" };

  const now = opts.now ?? Date.now();
  const deadline = opts.deadline ?? now + 20_000;
  const res: InboxPollResult = {
    accounts: accounts.length,
    conversations: 0,
    checked: 0,
    answered: 0,
    skipped: {},
    over_cap: 0,
    deferred: 0,
    errors: [],
  };
  const skip = (why: string) => (res.skipped[why] = (res.skipped[why] ?? 0) + 1);
  // Только 429 на весь ключ останавливает опрос; прочий сбой — в errors, идём дальше.
  const guard = async <T>(fn: () => Promise<T>, where: string): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      const limited = keyRateLimitSec(e);
      if (limited !== null) throw new RateLimited(limited);
      res.errors.push(`${where}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
      return null;
    }
  };

  const taskSince = await openTaskSince(ctx);
  const { isPersonMessage } = await import("./manager-guard");

  try {
    for (const account of accounts) {
      if (Date.now() > deadline) {
        res.deferred++;
        continue;
      }
      const list = await guard(
        () => deps.listConversations(account.id, account.platform),
        `диалоги ${account.platform}`,
      );
      if (!list) continue;
      if (list.length >= deps.page) res.page_full = (res.page_full ?? 0) + 1;
      // Входящее старше MAX_AGE_MS не отвечаем — и диалог, обновлённый раньше, не читаем.
      const fresh = list.filter((c) => {
        const at = Date.parse(c.updatedTime ?? "");
        return !Number.isFinite(at) || now - at <= MAX_AGE_MS;
      });
      res.conversations += fresh.length;
      const customers = await customersByConversation(
        ctx,
        fresh.map((c) => c.id),
      );
      // Менеджер ответил покупателю прямо в приложении: Zernio такого события
      // не шлёт, а следующего сообщения покупателя может не быть — задача
      // консультанта закрывается здесь, по хвосту переписки.
      const tails = new Map<string, ZernioInboxMessage[]>();
      let taskChecks = 0;
      for (const convo of fresh) {
        const customer = customers.get(convo.id);
        const since = customer && taskSince.get(customer.userKey);
        if (!customer || !since) continue;
        const updated = Date.parse(convo.updatedTime ?? "");
        if (Number.isFinite(updated) && updated <= Date.parse(since)) continue;
        if (taskChecks >= MAX_CONVERSATIONS || Date.now() > deadline) {
          res.deferred++;
          continue;
        }
        taskChecks++;
        const messages = await guard(
          () => deps.transport.tail(account.id, convo.id),
          `переписка ${convo.id}`,
        );
        if (!messages) continue;
        tails.set(convo.id, messages);
        const at = personReplyAfter(messages, since, ourReplies(customer), isPersonMessage);
        if (at === null) continue;
        const { closeTaskAfterReply } = await import("@/core/consultant/tasks");
        const closed = await closeTaskAfterReply(ctx, customer.userKey, new Date(now), {
          via: account.platform,
          repliedAt: new Date(at),
        });
        if (closed) {
          res.tasks_closed = (res.tasks_closed ?? 0) + 1;
          taskSince.delete(customer.userKey);
        }
      }

      // Не читать переписку там, где и так ясно: пауза или бот ответил позже обновления диалога.
      const toRead: ZernioConversation[] = [];
      for (const convo of fresh) {
        const memory = memoryOf(customers.get(convo.id), now);
        const updated = Date.parse(convo.updatedTime ?? "");
        const replied = Date.parse(memory.lastReplyAt ?? "");
        if (memory.paused) skip("paused");
        else if (Number.isFinite(updated) && Number.isFinite(replied) && updated <= replied)
          skip("answered");
        else toRead.push(convo);
      }
      res.over_cap += Math.max(0, toRead.length - MAX_CONVERSATIONS);

      for (const convo of toRead.slice(0, MAX_CONVERSATIONS)) {
        if (Date.now() > deadline) {
          res.deferred++;
          continue;
        }
        const messages =
          tails.get(convo.id) ??
          (await guard(() => deps.transport.tail(account.id, convo.id), `переписка ${convo.id}`));
        if (!messages) continue;
        res.checked++;
        const customer = customers.get(convo.id);
        const verdict = missedIncoming(messages, memoryOf(customer, now), now);
        if (!verdict.answer) {
          skip(verdict.why);
          continue;
        }
        const [key] = zernioMessageKeys(verdict.message);
        // Без id сообщения метку не поставить — позднему вебхуку было бы не видно, что ответ ушёл.
        if (!key) {
          skip("no_id");
          continue;
        }
        const senderId = senderIdOf(account.platform, customer, verdict.message, convo);
        if (!senderId) {
          skip("no_sender");
          continue;
        }
        const r = await answerMissed(ctx, deps, {
          eventId: pollEventId(t.id, key),
          account,
          convo,
          msg: verdict.message,
          senderId,
        });
        if (r === "processed") res.answered++;
        else skip(r);
      }
    }
  } catch (e) {
    if (!(e instanceof RateLimited)) throw e;
    res.rateLimitedSec = e.sec;
  }
  return res;
}

/**
 * Завести событие опроса и отдать обработчику — как вебхук (intake.server):
 * строка журнала `received` (уникальный event_id: второй крон её не заведёт),
 * захват received → retrying, отметка перед первой отправкой, итог в строку.
 */
async function answerMissed(
  ctx: TenantContext,
  deps: InboxPollDeps,
  p: Parameters<typeof pollPayload>[0],
): Promise<"processed" | "duplicate" | "log_failed" | "claimed" | "ignored" | "failed"> {
  const payload = pollPayload(p);
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: p.eventId,
    event_type: "message.received",
    status: "received",
    payload: scrubForLog(payload, { keys: false }) as never,
  });
  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) return "duplicate";
    console.error(`[inbox-poll:${ctx.tenant.id}] событие не записано: ${error.message}`);
    return "log_failed";
  }
  const { claimZernioEvent, markZernioEventSending, settleZernioEvent } =
    await import("./dispatch.server");
  if (!(await claimZernioEvent(ctx, p.eventId, new Date(), "webhook"))) return "claimed";
  const r = await runNotingEffects(
    () => markZernioEventSending(ctx, p.eventId),
    () => deps.dispatch(ctx, p.eventId, payload, deps.transport),
  );
  await settleZernioEvent(ctx, p.eventId, { ...r, note: r.note ? `опрос: ${r.note}` : "опрос" });
  return r.status;
}

/** Боевые зависимости: Zernio, настоящий обработчик, тумблер консультанта. */
export async function liveInboxPollDeps(): Promise<InboxPollDeps> {
  const api = await import("./api.server");
  const { dispatchZernioEvent } = await import("./dispatch.server");
  const { consultantEnabled } = await import("@/core/consultant/engine.server");
  return {
    listConversations: api.listInboxConversations,
    transport: api.liveTransport,
    dispatch: dispatchZernioEvent,
    consultantEnabled,
    page: api.INBOX_PAGE,
  };
}

/**
 * Крон: клиенты v2 по очереди, общий срок `deadline`. 429 Zernio — лимит на
 * весь ключ: остальных клиентов в этот запуск не трогаем.
 */
export async function runInboxPollFor(
  tenants: readonly Tenant[],
  tenantContext: (t: Tenant) => TenantContext,
  opts: { deadline: number; perTenantMs?: number; deps?: InboxPollDeps },
): Promise<Record<string, InboxPollResult | InboxPollSkip | { error: string }>> {
  const out: Record<string, InboxPollResult | InboxPollSkip | { error: string }> = {};
  const candidates = tenants.filter((t) => servedByV2(t) && pollAccounts(t).length);
  if (!candidates.length) return out;
  if (!opts.deps && !(await import("./api.server")).zernioConfigured()) return out;
  const deps = opts.deps ?? (await liveInboxPollDeps());
  let limitedSec: number | null = null;
  for (const t of candidates) {
    if (limitedSec !== null) {
      out[t.id] = { skipped: `zernio rate limit, ${limitedSec} s` };
      continue;
    }
    if (Date.now() >= opts.deadline) {
      out[t.id] = { skipped: "budget" };
      continue;
    }
    try {
      const r = await pollTenantInbox(tenantContext(t), deps, {
        deadline: Math.min(opts.deadline, Date.now() + (opts.perTenantMs ?? 20_000)),
      });
      if ("rateLimitedSec" in r && r.rateLimitedSec !== undefined) limitedSec = r.rateLimitedSec;
      out[t.id] = r;
    } catch (e) {
      out[t.id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}
