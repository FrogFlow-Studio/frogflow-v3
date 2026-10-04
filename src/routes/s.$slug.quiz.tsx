import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { storeQuizFn, storeQuizResultFn } from "@/app/storefront/quiz.functions";
import { useStorefrontLocale } from "@/app/storefront/locale";
import { formatMoney } from "@/core/money/money";
import type { StoreProduct } from "@/core/storefront/catalog";
import { Empty, ErrorBox, useAction } from "@/app/ui";

export const Route = createFileRoute("/s/$slug/quiz")({
  loader: ({ params }) => storeQuizFn({ data: { slug: params.slug } }),
  component: QuizPage,
});

/**
 * Подбор товара: вопросы по одному, в конце — до трёх товаров. Подсчёт — на
 * сервере (core/quiz), страница только собирает номера выбранных вариантов.
 */
function QuizPage() {
  const { slug } = Route.useParams();
  const quiz = Route.useLoaderData();
  const { t } = useStorefrontLocale();
  const [answers, setAnswers] = useState<number[]>([]);
  const [found, setFound] = useState<StoreProduct[] | null>(null);
  const finish = useAction(async (all: number[]) => {
    setFound(await storeQuizResultFn({ data: { slug, answers: all } }));
  });
  const toCatalog = (
    <Link to="/s/$slug" params={{ slug }} className="text-accent hover:underline">
      {t("cart.toCatalog")}
    </Link>
  );
  if (quiz.questions.length === 0)
    return (
      <Empty>
        {t("quiz.notReady")} {toCatalog}
      </Empty>
    );
  const restart = () => {
    setAnswers([]);
    setFound(null);
  };
  if (found || finish.busy || answers.length >= quiz.questions.length) {
    return (
      <div>
        <h1 className="mb-4 text-xl font-semibold">{t("quiz.title")}</h1>
        <ErrorBox error={finish.error} />
        {found && found.length === 0 && <Empty>{t("quiz.nothing")}</Empty>}
        {found && found.length > 0 && (
          <>
            <p className="mb-3 text-sm text-muted">{t("quiz.result")}</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {found.map((p) => (
                <Link
                  key={p.id}
                  to="/s/$slug/p/$id"
                  params={{ slug, id: p.id }}
                  className="card flex flex-col overflow-hidden"
                >
                  {p.images[0] ? (
                    <img
                      src={p.images[0]}
                      alt={p.name}
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center bg-surface-2 text-4xl">
                      {p.kind === "digital" ? "📄" : "📦"}
                    </div>
                  )}
                  <div className="p-3 text-sm">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-muted">{formatMoney(p.price, p.currency)}</div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
          <button className="btn-secondary" onClick={restart}>
            {t("quiz.again")}
          </button>
          {toCatalog}
        </div>
      </div>
    );
  }
  const q = answers.length;
  const question = quiz.questions[q]!;
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 text-xl font-semibold">{t("quiz.title")}</h1>
      {q === 0 && quiz.intro && <p className="mb-3 text-sm text-muted">{quiz.intro}</p>}
      <p className="mb-3 text-xs text-muted">
        {t("quiz.step", { n: q + 1, m: quiz.questions.length })}
      </p>
      <h2 className="mb-3 text-lg font-medium">{question.text}</h2>
      <div className="flex flex-col gap-2">
        {question.options.map((o, i) => (
          <button
            key={i}
            className="btn-secondary justify-start text-left"
            onClick={() => {
              const next = [...answers, i];
              setAnswers(next);
              if (next.length >= quiz.questions.length) void finish.run(next).catch(() => {});
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {q > 0 && (
        <button className="btn-ghost mt-4 text-sm" onClick={() => setAnswers(answers.slice(0, -1))}>
          {t("quiz.back")}
        </button>
      )}
    </div>
  );
}
