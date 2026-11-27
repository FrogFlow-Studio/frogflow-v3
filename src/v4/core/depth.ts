import { serverFailure } from "@/lib/server-failure";
import { attempt, type V4Db, type V4Result } from "./db";

/**
 * Глубина без модели: заявка входящего, ответ продавца своим текстом,
 * шаг выдачи, поиск, кандидаты экзамена, сводка «стоил / принёс».
 * Пополнение баланса отсюда не зовётся.
 */

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const one = (rows: Row[], fn: string): Row => {
  const r = rows[0];
  if (!r) throw serverFailure(`v4.${fn}: пустой ответ`);
  return r;
};
const cell = (row: Row, fn: string) => row[fn];

export function claimInbound(
  db: V4Db,
  input: { botId: string; channel: string; externalId: string },
): Promise<boolean> {
  return db
    .call("claim_inbound", {
      p_bot_id: input.botId,
      p_channel: input.channel,
      p_external_id: input.externalId,
    })
    .then((rows) => Boolean(cell(one(rows, "claim_inbound"), "claim_inbound")));
}

export function sellerReply(
  db: V4Db,
  input: { botId: string; caseId: string; text: string; by: string },
): Promise<V4Result<boolean>> {
  return attempt(async () =>
    Boolean(
      cell(
        one(
          await db.call("seller_reply", {
            p_bot_id: input.botId,
            p_case_id: input.caseId,
            p_text: input.text,
            p_by: input.by,
          }),
          "seller_reply",
        ),
        "seller_reply",
      ),
    ),
  );
}

export async function lastFulfillmentStep(
  db: V4Db,
  input: { botId: string; orderId: string },
): Promise<string | null> {
  const rows = await db.call("last_fulfillment_step", {
    p_bot_id: input.botId,
    p_order_id: input.orderId,
  });
  const raw = rows[0]?.last_fulfillment_step;
  if (raw == null || raw === "") return null;
  return String(raw);
}

const NEXT: Record<string, "accepted" | "working" | "ready" | "handed" | null> = {
  "": "accepted",
  accepted: "working",
  working: "ready",
  ready: "handed",
  handed: null,
};

/** Следующий шаг физического заказа. После «передан» кнопки нет. */
export function nextFulfillmentStep(
  last: string | null,
): "accepted" | "working" | "ready" | "handed" | null {
  return NEXT[last ?? ""] ?? null;
}

export async function catalogSearchMode(db: V4Db): Promise<"trgm" | "typo"> {
  const raw = String(
    cell(one(await db.call("catalog_search_mode", {}), "catalog_search_mode"), "catalog_search_mode"),
  );
  return raw === "trgm" ? "trgm" : "typo";
}

export type FoundProduct = {
  productId: string;
  title: string;
  variantLabel: string | null;
  kind: string;
  hasVariants: boolean;
};

export async function findProductsWide(
  db: V4Db,
  input: { botId: string; query: string; limit?: number },
): Promise<FoundProduct[]> {
  const rows = await db.call("find_products_wide", {
    p_bot_id: input.botId,
    p_query: input.query,
    p_limit: input.limit ?? 8,
  });
  return rows.map((r) => ({
    productId: String(r.product_id),
    title: String(r.title),
    variantLabel: (r.variant_label as string | null) ?? null,
    kind: String(r.kind),
    hasVariants: Boolean(r.has_variants),
  }));
}

export type ExamCandidate = { id: number; question: string; answer: string; accepted: boolean };

export async function listExamCandidates(db: V4Db, botId: string): Promise<ExamCandidate[]> {
  const rows = await db.call("list_exam_candidates", { p_bot_id: botId });
  return rows.map((r) => ({
    id: num(r.id),
    question: String(r.question),
    answer: String(r.answer),
    accepted: Boolean(r.accepted),
  }));
}

export type ExamFixture = { question: string; answer: string; mode: "recorded" };

export async function acceptExamCandidate(
  db: V4Db,
  input: { botId: string; id: number },
): Promise<V4Result<{ already: boolean; fixture: ExamFixture }>> {
  return attempt(async () => {
    const raw = cell(
      one(
        await db.call("accept_exam_candidate", { p_bot_id: input.botId, p_id: input.id }),
        "accept_exam_candidate",
      ),
      "accept_exam_candidate",
    );
    const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
      already: boolean;
      fixture: ExamFixture;
    };
    return { already: Boolean(r.already), fixture: r.fixture };
  });
}

export type ValueReport = {
  repliesModel: number;
  repliesSimple: number;
  spentMicroUsd: number;
  ordersPaid: number;
};

/** Чтение сводки. Живую модель не вызывает и баланс не пополняет. */
export async function readValueReport(
  db: V4Db,
  input: { botId: string; from: Date; to: Date },
): Promise<ValueReport> {
  const raw = cell(
    one(
      await db.call("ai_value_report", {
        p_bot_id: input.botId,
        p_from: input.from.toISOString(),
        p_to: input.to.toISOString(),
      }),
      "ai_value_report",
    ),
    "ai_value_report",
  );
  const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  return {
    repliesModel: num(r.replies_model),
    repliesSimple: num(r.replies_simple),
    spentMicroUsd: num(r.spent_micro_usd),
    ordersPaid: num(r.orders_paid),
  };
}

/** Расхождение кошелька и книги, без записи дела. */
export async function readWalletDrift(db: V4Db, botId: string): Promise<number> {
  return num(
    cell(
      one(await db.call("ai_wallet_drift", { p_bot_id: botId }), "ai_wallet_drift"),
      "ai_wallet_drift",
    ),
  );
}
