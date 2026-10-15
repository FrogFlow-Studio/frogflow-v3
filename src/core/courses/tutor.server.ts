import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { modelParams } from "@/core/ai/pure";
import { updateSettingStamped } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Locale } from "@/core/i18n/locale";
import { previewReadonly } from "@/lib/preview";
import { pageAll } from "@/core/db/page";
import { getHomework, studentName } from "./homework.server";
import { purchaseTimeline, startRun, type CoursePurchase } from "./run.server";
import {
  parseTutor,
  tutorKey,
  tutorLeft,
  tutorPrompt,
  tutorSystem,
  withExchange,
  withQuestion,
  TUTOR_ANSWER_MAX,
  TUTOR_MAX_TOKENS,
  TUTOR_MODEL,
  TUTOR_KEY_PREFIX,
  TUTOR_QUESTION_MAX,
  type TutorKind,
  type TutorRecord,
} from "./tutor";

/** Тайм-аут вызова модели: ученик ждёт на странице. */
const TIMEOUT_MS = 25_000;
/** Бронь ИИ-баланса на вопрос, $: короткий урок и до 600 токенов ответа Haiku. */
export const TUTOR_RESERVE_USD = 0.02;

/** Вызов модели; подменяется в тестах. */
export type TutorModel = (req: {
  system: string;
  prompt: string;
}) => Promise<{ text: string; usd: number }>;

const anthropicModel =
  (apiKey: string): TutorModel =>
  async ({ system, prompt }) => {
    const { callUsd } = await import("@/core/consultant/engine.server");
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS });
    const r = await client.messages.create(
      {
        model: TUTOR_MODEL,
        max_tokens: TUTOR_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: prompt }],
        ...modelParams(TUTOR_MODEL),
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const text = r.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    return { text, usd: callUsd(TUTOR_MODEL, r.usage) };
  };

export type TutorAsk =
  | { ok: true; kind: TutorKind; answer: string; asked: number; left: number }
  | { ok: false; reason: "off" | "closed" | "empty" | "stale" | "limit" | "conflict" };

/**
 * Вопрос наставнику по открытому уроку покупки. Сначала условная запись
 * занимает вопрос (счётчик `asked` должен совпасть с тем, что видел ученик,
 * и дневной лимит не исчерпан): двойной клик не задаёт вопрос дважды и не
 * платит дважды. Потом бронь ИИ-баланса и вызов модели. Модель недоступна
 * (нет ключа, баланс, сбой, тайм-аут) — ответ `unavailable`: страница
 * предлагает спросить куратора. Вызов не повторяем: он мог дойти и списаться.
 */
export async function askTutor(
  ctx: TenantContext,
  p: CoursePurchase,
  input: { lessonId: string; question: string; asked: number; locale: Locale },
  now = new Date(),
  model?: TutorModel,
): Promise<TutorAsk> {
  if (!p.course.tutor) return { ok: false, reason: "off" };
  const run = await startRun(ctx, p, now);
  const access = purchaseTimeline(ctx, { ...p, run }, now).access.find(
    (a) => a.lesson.id === input.lessonId,
  );
  if (!access?.open) return { ok: false, reason: "closed" };
  const question = input.question.trim().slice(0, TUTOR_QUESTION_MAX);
  if (!question) return { ok: false, reason: "empty" };

  const lesson = access.lesson;
  const key = tutorKey(p.orderItemId, lesson.id);
  const who = {
    course: p.name,
    lessonNo: access.no,
    lessonTitle: lesson.title,
    student: await studentName(ctx, p.orderId),
  };
  let reason: "stale" | "limit" | null = null;
  let claimed: TutorRecord | null = null;
  const claim = await updateSettingStamped(ctx, key, (raw) => {
    reason = null;
    const cur = parseTutor(raw);
    if (cur.asked !== input.asked) {
      reason = "stale";
      return null;
    }
    if (tutorLeft(cur, now) <= 0) {
      reason = "limit";
      return null;
    }
    claimed = withQuestion(cur, now, who);
    return JSON.stringify(claimed);
  });
  if (reason) return { ok: false, reason };
  const rec = claimed as TutorRecord | null;
  if (claim !== "written" || !rec) return { ok: false, reason: "conflict" };

  const hw = lesson.homework ? await getHomework(ctx, p.orderItemId, lesson.id) : null;
  const answer = await callTutor(
    ctx,
    {
      system: tutorSystem(input.locale),
      prompt: tutorPrompt({
        ...who,
        lessonText: lesson.text,
        task: lesson.homework ?? null,
        attempt: hw?.attempts.at(-1)?.text ?? null,
        feedback: hw?.feedback?.text ?? null,
        question,
      }),
    },
    model,
  );

  const exchange = { at: now.toISOString(), q: question, ...answer };
  const logged = await updateSettingStamped(ctx, key, (raw) =>
    JSON.stringify(withExchange(parseTutor(raw), exchange)),
  );
  if (logged !== "written")
    console.error(`[tutor:${ctx.tenant.id}] журнал не записан (${logged}) ${key}`);
  return { ok: true, ...answer, asked: rec.asked, left: tutorLeft(rec, now) };
}

async function callTutor(
  ctx: TenantContext,
  req: { system: string; prompt: string },
  model?: TutorModel,
): Promise<{ kind: TutorKind; a: string; answer: string }> {
  const none = { kind: "unavailable" as const, a: "", answer: "" };
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!model && (!apiKey || previewReadonly())) return none;
  const { aiReserve, aiSettle } = await import("@/core/ai/balance");
  const hold = await aiReserve(ctx, "tutor", TUTOR_RESERVE_USD);
  if (typeof hold === "string") return none;
  try {
    const r = await (model ?? anthropicModel(apiKey!))(req);
    await aiSettle(ctx, hold, r.usd);
    const text = r.text.slice(0, TUTOR_ANSWER_MAX);
    return text ? { kind: "answer", a: text, answer: text } : none;
  } catch (e) {
    // Вызов мог дойти и списаться: бронь остаётся расходом, без повтора.
    console.error(`[tutor:${ctx.tenant.id}] модель: ${String(e)}`);
    await aiSettle(ctx, hold, TUTOR_RESERVE_USD);
    return none;
  }
}

export type TutorThread = TutorRecord & { key: string; lastAt: string };

/**
 * Вопросы учеников наставнику для преподавателя: все записи магазина
 * постранично, свежие сверху. Сбой чтения — `serverFailure` (pageAll).
 */
export async function listTutor(ctx: TenantContext): Promise<TutorThread[]> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${TUTOR_KEY_PREFIX}%`)
        .order("key")
        .range(from, to),
    "вопросы наставнику",
  );
  return rows
    .flatMap((r) => {
      const t = parseTutor(r.value);
      const lastAt = t.log.at(-1)?.at;
      return lastAt ? [{ ...t, key: r.key, lastAt }] : [];
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.key.localeCompare(b.key));
}
