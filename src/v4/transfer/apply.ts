import { serverFailure } from "@/lib/server-failure";
import type { V4Db } from "../core/db";
import type { ReportLine, TransferPlan } from "./plan";

/**
 * Запись плана переноса в v4 (migrations/v4/022-transfer-from-v3.sql) и
 * остатка ИИ (018, ai_transfer_from_v3). Только сервисная роль, в день
 * переезда; повторный запуск ничего не задваивает. Итог — счёт записанного и
 * отчёт «проверить» (план + покупатели, которых нет в v4).
 */

export type TransferResult = {
  knowledge: number;
  products: number;
  histories: number;
  blocked: number;
  balanceMicroUsd: number | null;
  report: ReportLine[];
};

/** Книга остатка v3. Запись проходит, только если сейчас ровно expectedUsd. */
export type BalanceBook = {
  set(nextUsd: number, expectedUsd: number): Promise<boolean>;
};

export async function applyTransfer(
  db: V4Db,
  botId: string,
  plan: TransferPlan,
  opts: { withBalance: boolean; by: string; now?: Date; book?: BalanceBook },
): Promise<TransferResult> {
  const now = opts.now ? { p_now: opts.now.toISOString() } : {};
  const r = (
    await db.call("transfer_from_v3", {
      p_bot_id: botId,
      p_plan: {
        profile: plan.profile,
        default_lang: plan.defaultLang,
        features: plan.features,
        knowledge: plan.knowledge.map((k) => ({
          question: k.question,
          answer: k.answer,
          needs_review: k.needsReview,
        })),
        product_texts: plan.productTexts.map((p) => ({
          product_id: p.productId,
          description: p.description,
          keywords: p.keywords,
          photos: p.photos,
        })),
        histories: plan.histories.map((h) => ({ telegram_id: h.telegramId, messages: h.messages })),
        blocked_telegram_ids: plan.blockedTelegramIds,
      },
      ...now,
    })
  )[0]?.transfer_from_v3 as
    | {
        knowledge: number;
        products: number;
        histories: number;
        blocked: number;
        missing_buyers: string[];
      }
    | undefined;
  if (!r) throw serverFailure("v4.transfer_from_v3: пустой ответ");

  const report = [...plan.report];
  if (r.missing_buyers.length)
    report.push({
      area: "история",
      item: `${r.missing_buyers.length} покупателей Telegram`,
      reason: "нет в v4 (не перенесены с каталогом) — их история консультанта не перенесена",
    });

  let balanceMicroUsd: number | null = null;
  if (opts.withBalance && plan.balanceUsd !== null) {
    const b = (
      await db.call("ai_transfer_from_v3", {
        p_bot_id: botId,
        p_usd: plan.balanceUsd,
        p_created_by: opts.by,
        ...now,
      })
    )[0]?.ai_transfer_from_v3 as { micro_usd?: number | string; transferred?: boolean } | undefined;
    if (!b) throw serverFailure("v4.ai_transfer_from_v3: пустой ответ");
    balanceMicroUsd = Number(b.micro_usd);
    if (b.transferred && opts.book) {
      const cleared = await opts.book.set(0, plan.balanceUsd);
      if (!cleared) {
        await db.call("ai_transfer_to_v3", {
          p_bot_id: botId,
          p_created_by: opts.by,
          ...now,
        });
        throw serverFailure("остаток v3 изменился во время переноса");
      }
    }
  } else if (plan.balanceUsd !== null) {
    report.push({
      area: "кошелёк",
      item: `остаток ${plan.balanceUsd} долл.`,
      reason: "переносится после переключения магазина на v4 — запустить ещё раз с остатком",
    });
  }
  return {
    knowledge: Number(r.knowledge),
    products: Number(r.products),
    histories: Number(r.histories),
    blocked: Number(r.blocked),
    balanceMicroUsd,
    report,
  };
}

/** Откат остатка: v4 отдаёт сумму, книга v3 принимает её, только если там ноль. */
export async function revertTransferBalance(
  db: V4Db,
  botId: string,
  book: BalanceBook,
  by: string,
  now?: Date,
): Promise<number> {
  const stamp = now ? { p_now: now.toISOString() } : {};
  const micro = Number(
    (await db.call("ai_transfer_to_v3", { p_bot_id: botId, p_created_by: by, ...stamp }))[0]
      ?.ai_transfer_to_v3,
  );
  if (!Number.isFinite(micro)) throw serverFailure("v4.ai_transfer_to_v3: пустой ответ");
  const wrote = await book.set(micro / 1_000_000, 0);
  if (!wrote) throw serverFailure("остаток v3 уже не ноль, откат не записан");
  return micro;
}
