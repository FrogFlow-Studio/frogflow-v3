import { serverFailure } from "@/lib/server-failure";
import type { SendOutcome } from "../core/cases/cases";
import type { V4Db } from "../core/db";
import { asLang, TEXTS } from "../seller/texts";
import type { InstagramChannel } from "./channel";

/**
 * Comment-to-DM v4 (этап 4б). Логика «один раз» — в SQL
 * (migrations/v4/006-comments.sql), здесь — только вызов канала и итог.
 * Публичный ответ под комментарием и сообщение в Direct — оба, так задумано.
 */

export const COMMENT_VERDICTS = ["spam", "no_rule", "rule", "nested"] as const;
export type CommentVerdict = (typeof COMMENT_VERDICTS)[number];

export type AcceptedComment = {
  commentId: string;
  created: boolean;
  verdict: CommentVerdict;
  buyerId: string;
};

/** Входящий комментарий из вебхука. Повтор вебхука — та же строка, created=false. */
export async function acceptComment(
  db: V4Db,
  input: {
    botId: string;
    externalId: string;
    postId: string | null;
    commenterId: string;
    text: string;
    commentedAt: Date;
    nested?: boolean;
    now?: Date;
  },
): Promise<AcceptedComment> {
  const args: Record<string, unknown> = {
    p_bot_id: input.botId,
    p_channel: "instagram",
    p_external_id: input.externalId,
    p_post_id: input.postId,
    p_commenter: input.commenterId,
    p_text: input.text,
    p_commented_at: input.commentedAt.toISOString(),
    p_nested: input.nested ?? false,
  };
  if (input.now) args.p_now = input.now.toISOString();
  const r = (await db.call("accept_comment", args))[0];
  if (!r) throw serverFailure("v4.accept_comment: пустой ответ");
  return {
    commentId: String(r.comment_id),
    created: Boolean(r.created),
    verdict: r.verdict as CommentVerdict,
    buyerId: String(r.buyer_id),
  };
}

/** Автоматизация Zernio уже написала в Direct — наш резерв не отправляет. */
export async function noteExternalDm(db: V4Db, botId: string, externalId: string) {
  const r = await db.call("note_external_dm", {
    p_bot_id: botId,
    p_channel: "instagram",
    p_external_id: externalId,
  });
  return Boolean(r[0]?.note_external_dm);
}

/** Общий бюджет одного прохода, мс: меньше 120 с функции (CLAUDE.md). */
const RUN_BUDGET_MS = 100_000;
const PER_CALL_MS = 10_000;
/** Забираем понемногу: худший случай пачки (4 × 10 с) укладывается в остаток бюджета. */
const BATCH_PER_KIND = 2;

export type CommentRunStats = Record<"public" | "dm", Record<SendOutcome, number>>;

/**
 * Проход отправщика (сервисная роль, крон раз в минуту). Каждая отправка
 * сначала забрана условной записью (pending → sending), потом отправлена,
 * потом записан итог. Исключение канала — unknown: могло дойти.
 */
export async function runCommentSends(
  db: V4Db,
  channelFor: (botId: string) => InstagramChannel | null,
  opts: { now?: () => Date; budgetMs?: number; perCallMs?: number } = {},
): Promise<CommentRunStats> {
  const now = opts.now ?? (() => new Date());
  const perCall = opts.perCallMs ?? PER_CALL_MS;
  const deadline = Date.now() + (opts.budgetMs ?? RUN_BUDGET_MS);
  const stats: CommentRunStats = {
    public: { sent: 0, failed: 0, unknown: 0 },
    dm: { sent: 0, failed: 0, unknown: 0 },
  };
  while (Date.now() + 4 * perCall < deadline) {
    const rows = await db.call("claim_comment_sends", {
      p_limit: BATCH_PER_KIND,
      p_now: now().toISOString(),
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      const kind = r.kind as "public" | "dm";
      const ch = channelFor(String(r.bot_id));
      let outcome: SendOutcome = "failed";
      if (ch) {
        const signal = AbortSignal.timeout(perCall);
        const externalId = String(r.external_id);
        const text = String(r.text);
        try {
          outcome =
            kind === "public"
              ? await ch.publicReply(externalId, text, signal)
              : await ch.privateReply(externalId, text, signal);
        } catch {
          outcome = "unknown";
        }
      }
      stats[kind][outcome]++;
      await db.call("finish_comment_send", {
        p_comment_id: r.comment_id,
        p_kind: kind,
        p_outcome: outcome,
        p_now: now().toISOString(),
      });
    }
  }
  return stats;
}

/**
 * Покупатель написал в Direct. Ждёт карточку после первого сообщения — шлём
 * её один раз и отвечаем handled; иначе сообщение отвечает продавец-бот.
 */
export async function onDirectMessage(
  db: V4Db,
  channel: InstagramChannel,
  input: { botId: string; buyerId: string; recipientId: string; lang?: string; now?: Date },
): Promise<{ handled: boolean; outcome?: SendOutcome }> {
  const args: Record<string, unknown> = { p_bot_id: input.botId, p_buyer_id: input.buyerId };
  if (input.now) args.p_now = input.now.toISOString();
  const card = (await db.call("claim_card", args))[0];
  if (!card) return { handled: false };
  const commentId = String(card.comment_id);
  const product = (
    await db.call("product_card", { p_bot_id: input.botId, p_product_id: card.product_id })
  )[0];
  if (!product || product.has_variants) {
    // Товар сняли с продажи или у него теперь варианты: карточку не шлём, отвечает бот.
    await finishCard(db, input.botId, commentId, "failed");
    return { handled: false };
  }
  const lang = asLang(input.lang);
  let outcome: SendOutcome;
  try {
    outcome = await channel.sendCard(
      input.recipientId,
      String(card.card_text),
      [
        {
          kind: "buy",
          productId: String(card.product_id),
          // Одна кнопка под карточкой: короткая подпись влезает в предел Instagram (20 знаков).
          label: TEXTS.buy[lang],
        },
      ],
      AbortSignal.timeout(PER_CALL_MS),
    );
  } catch {
    outcome = "unknown";
  }
  await finishCard(db, input.botId, commentId, outcome);
  return { handled: true, outcome };
}

async function finishCard(db: V4Db, botId: string, commentId: string, outcome: SendOutcome) {
  await db.call("finish_card", { p_bot_id: botId, p_comment_id: commentId, p_outcome: outcome });
}
