import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { newsListFn, newsStateFn, saveNewsFn } from "@/app/operator/operator.functions";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { NEWS_PLAN_TIERS, type NewsPlanTier } from "@/core/news/news";

export const Route = createFileRoute("/operator/_authed/news")({
  loader: () => newsListFn(),
  component: NewsAdmin,
});

const LANGS = ["ru", "kk", "en", "uz"] as const;
const LANG_NAME = { ru: "Русский", kk: "Қазақша", en: "English", uz: "Oʻzbekcha" } as const;
const TIER_NAME: Record<NewsPlanTier, string> = {
  basic: "Basic",
  pro: "Pro",
  business: "Business",
  custom: "По договору",
};
type Texts = Record<(typeof LANGS)[number], string>;
const blank = (): Texts => ({ ru: "", kk: "", en: "", uz: "" });
const fill = (v: Record<string, string>): Texts => ({ ...blank(), ...v });

/** Новости платформы: пишем, публикуем (один раз), убираем в архив. Продавцы видят их в «Что нового». */
function NewsAdmin() {
  const list = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState<Texts>(blank());
  const [body, setBody] = useState<Texts>(blank());
  const [plans, setPlans] = useState<NewsPlanTier[]>([]);
  const save = useAction(async () => {
    await saveNewsFn({ data: { id: editing, title, body, plans } });
    setEditing(null);
    setTitle(blank());
    setBody(blank());
    setPlans([]);
    await router.invalidate();
  });
  const state = useAction(async (id: string, action: "publish" | "archive" | "unarchive") => {
    if (action === "publish" && !confirm("Опубликовать? Продавцы сразу увидят новость.")) return;
    await newsStateFn({ data: { id, action } });
    await router.invalidate();
  });

  if (!list)
    return (
      <>
        <PageTitle title="Новости платформы" subtitle="Лента «Что нового» у продавцов." />
        <Card>
          <Empty>
            Таблиц новостей в базе ещё нет: раздел включится после миграции 19-5 (применяет Яков). У
            продавцов сейчас показано «скоро».
          </Empty>
        </Card>
      </>
    );
  return (
    <>
      <PageTitle
        title="Новости платформы"
        subtitle="Пишем на русском; пустой язык продавец увидит по-русски. Тарифы не выбраны — новость для всех."
      />
      <Card>
        <div className="space-y-3 p-4">
          <h2 className="font-medium">{editing ? "Правка новости" : "Новая новость"}</h2>
          <ErrorBox error={save.error} />
          {LANGS.map((l) => (
            <div key={l} className="space-y-1">
              <input
                className="input w-full"
                value={title[l]}
                maxLength={120}
                placeholder={`Заголовок · ${LANG_NAME[l]}`}
                aria-label={`Заголовок ${LANG_NAME[l]}`}
                onChange={(e) => setTitle({ ...title, [l]: e.target.value })}
              />
              <textarea
                className="input w-full"
                rows={3}
                value={body[l]}
                maxLength={4000}
                placeholder={`Текст · ${LANG_NAME[l]}`}
                aria-label={`Текст ${LANG_NAME[l]}`}
                onChange={(e) => setBody({ ...body, [l]: e.target.value })}
              />
            </div>
          ))}
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="mb-1 text-muted">Кому показать</legend>
            {NEWS_PLAN_TIERS.map((p) => (
              <label key={p} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={plans.includes(p)}
                  onChange={(e) =>
                    setPlans(e.target.checked ? [...plans, p] : plans.filter((x) => x !== p))
                  }
                />
                {TIER_NAME[p]}
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={save.busy || !title.ru.trim() || !body.ru.trim()}
              onClick={() => void save.run().catch(() => {})}
            >
              {editing ? "Сохранить" : "Сохранить черновик"}
            </button>
            {editing && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setEditing(null);
                  setTitle(blank());
                  setBody(blank());
                  setPlans([]);
                }}
              >
                Отмена
              </button>
            )}
          </div>
        </div>
      </Card>
      <ErrorBox error={state.error} />
      <Card>
        {list.length === 0 ? (
          <Empty>Новостей пока нет.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{n.title.ru}</span>
                  <span className="text-xs text-muted">
                    {n.plans.length ? n.plans.map((p) => TIER_NAME[p]).join(", ") : "всем тарифам"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {n.archived ? (
                    <Badge>в архиве</Badge>
                  ) : n.publishedAt ? (
                    <Badge tone="ok">опубликовано</Badge>
                  ) : (
                    <Badge tone="warn">черновик</Badge>
                  )}
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      setEditing(n.id);
                      setTitle(fill(n.title));
                      setBody(fill(n.body));
                      setPlans(n.plans);
                    }}
                  >
                    Править
                  </button>
                  {!n.publishedAt && !n.archived && (
                    <button
                      type="button"
                      className="btn-primary text-xs"
                      disabled={state.busy}
                      onClick={() => void state.run(n.id, "publish").catch(() => {})}
                    >
                      Опубликовать
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    disabled={state.busy}
                    onClick={() =>
                      void state.run(n.id, n.archived ? "unarchive" : "archive").catch(() => {})
                    }
                  >
                    {n.archived ? "Вернуть" : "В архив"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
