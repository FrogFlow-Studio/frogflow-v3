import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { previewQuizFn, quizFn, saveQuizFn } from "@/app/admin/quiz.functions";
import { adminT } from "@/app/i18n/admin";
import { Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { HelpTip } from "@/app/admin/help-panel";

export const Route = createFileRoute("/admin/_authed/quiz")({
  loader: () => quizFn(),
  component: QuizPage,
});

type Q = { text: string; options: Array<{ label: string; tags: string }> };

function QuizPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [intro, setIntro] = useState(data.intro);
  const [qs, setQs] = useState<Q[]>(
    data.questions.map((q) => ({
      text: q.text,
      options: q.options.map((o) => ({ label: o.label, tags: o.tags.join(", ") })),
    })),
  );
  const [picked, setPicked] = useState<number[]>([]);
  const [preview, setPreview] = useState<Array<{ id: string; name: string }> | null>(null);
  const [saved, setSaved] = useState(false);
  const toInput = () => ({
    intro,
    questions: qs.map((q) => ({
      text: q.text,
      options: q.options.map((o) => ({
        label: o.label,
        tags: o.tags
          .split(/[,;]+/)
          .map((x) => x.trim())
          .filter(Boolean),
      })),
    })),
  });
  const save = useAction(async () => {
    await saveQuizFn({ data: toInput() });
    setSaved(true);
    await router.invalidate();
  });
  const check = useAction(async () => {
    const tags = qs.flatMap((q, i) =>
      (q.options[picked[i] ?? 0]?.tags ?? "")
        .split(/[,;]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    );
    setPreview(await previewQuizFn({ data: { tags } }));
  });
  const setQ = (i: number, patch: Partial<Q>) =>
    setQs((x) => x.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setO = (i: number, k: number, patch: Partial<Q["options"][number]>) =>
    setQ(i, { options: qs[i]!.options.map((o, j) => (j === k ? { ...o, ...patch } : o)) });
  return (
    <>
      <PageTitle title={t("quiz.title")} subtitle={t("quiz.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            void save.run().catch(() => {});
          }}
        >
          <Card title={t("quiz.intro")} help={<HelpTip article="quiz" anchor="intro" />}>
            <textarea
              className="input min-h-16"
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
            />
          </Card>
          {qs.map((q, i) => (
            <Card
              key={i}
              title={t("quiz.question", { n: i + 1 })}
              actions={
                <button
                  type="button"
                  className="btn-ghost text-xs text-danger"
                  onClick={() => setQs((x) => x.filter((_, j) => j !== i))}
                >
                  {t("quiz.removeQuestion")}
                </button>
              }
            >
              <input
                className="input mb-3"
                value={q.text}
                onChange={(e) => setQ(i, { text: e.target.value })}
                required
              />
              <div className="space-y-2">
                {q.options.map((o, k) => (
                  <div key={k} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                    <input
                      className="input"
                      placeholder={t("quiz.optionLabel")}
                      maxLength={40}
                      value={o.label}
                      onChange={(e) => setO(i, k, { label: e.target.value })}
                    />
                    <input
                      className="input"
                      placeholder={t("quiz.optionTags")}
                      value={o.tags}
                      onChange={(e) => setO(i, k, { tags: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      disabled={q.options.length <= 2}
                      onClick={() => setQ(i, { options: q.options.filter((_, j) => j !== k) })}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              {q.options.length < 6 && (
                <button
                  type="button"
                  className="btn-ghost mt-2 text-xs"
                  onClick={() => setQ(i, { options: [...q.options, { label: "", tags: "" }] })}
                >
                  {t("quiz.addOption")}
                </button>
              )}
            </Card>
          ))}
          <p className="flex items-center gap-1.5 text-xs text-muted">
            {t("quiz.tagsHint")}
            <HelpTip article="quiz" anchor="tags" />
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {qs.length < 5 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  setQs((x) => [
                    ...x,
                    {
                      text: "",
                      options: [
                        { label: "", tags: "" },
                        { label: "", tags: "" },
                      ],
                    },
                  ])
                }
              >
                {t("quiz.addQuestion")}
              </button>
            )}
            <button className="btn-primary" disabled={save.busy}>
              {t("common.save")}
            </button>
            {saved && <span className="text-xs text-ok">✓</span>}
          </div>
          <ErrorBox error={save.error} />
        </form>
        <Card title={t("quiz.preview")} help={<HelpTip article="quiz" anchor="preview" />}>
          <p className="mb-3 text-xs text-muted">{t("quiz.previewHint")}</p>
          <div className="space-y-2">
            {qs.map((q, i) => (
              <Field key={i} label={q.text || t("quiz.question", { n: i + 1 })}>
                <select
                  className="input"
                  value={picked[i] ?? 0}
                  onChange={(e) =>
                    setPicked((x) => {
                      const n = [...x];
                      n[i] = Number(e.target.value);
                      return n;
                    })
                  }
                >
                  {q.options.map((o, k) => (
                    <option key={k} value={k}>
                      {o.label || "—"}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary mt-3"
            disabled={check.busy || !qs.length}
            onClick={() => void check.run().catch(() => {})}
          >
            {t("quiz.preview")}
          </button>
          {preview && (
            <ul className="mt-3 space-y-1 text-sm">
              {preview.length === 0 ? (
                <li className="text-muted">{t("quiz.previewEmpty")}</li>
              ) : (
                preview.map((p) => <li key={p.id}>• {p.name}</li>)
              )}
            </ul>
          )}
          <ErrorBox error={check.error} />
        </Card>
      </div>
    </>
  );
}
