import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { saveProductFn } from "@/app/admin/products.functions";
import { saveCourseFn } from "@/app/admin/courses.functions";
import { adminT } from "@/app/i18n/admin";
import { Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { canEdit } from "@/core/auth/roles";
import {
  LESSON_TITLE_MAX,
  LESSON_VIDEOS_MAX,
  LESSONS_MAX,
  parseCourseOutline,
  type CourseOutlineSkip,
} from "@/core/courses/course";

export const Route = createFileRoute("/admin/_authed/products_/new-course")({
  component: NewCourseWizard,
});

/**
 * Мастер «Новый курс» (ниша «Онлайн-школа»): название, цена и уроки списком на
 * одном экране. Создаёт тот же товар-курс, что полная форма (`saveProductFn`
 * с `isCourse`), и сразу его уроки (`saveCourseFn`), потом открывает карточку
 * курса. Уроки ещё не записались — товар уже есть: повторное нажатие пишет
 * уроки в него же, второй товар не появляется.
 */
function NewCourseWizard() {
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [free, setFree] = useState(true);
  const [tried, setTried] = useState(false);
  const created = useRef<string | null>(null);
  const outline = useMemo(() => parseCourseOutline(text), [text]);

  const reason = (s: CourseOutlineSkip) =>
    t(
      s.reason === "noLink"
        ? "courseWizard.noLink"
        : s.reason === "tooManyVideos"
          ? "courseWizard.tooManyVideos"
          : s.reason === "notHttps"
            ? "school.listNotHttps"
            : s.reason === "noTitle"
              ? "school.listNoTitle"
              : "school.listTooLong",
      { line: s.line, max: s.reason === "tooManyVideos" ? LESSON_VIDEOS_MAX : LESSON_TITLE_MAX },
    );
  const blocked =
    outline.lessons.length === 0 || outline.skipped.length > 0 || outline.overLimit > 0;

  const create = useAction(async (f: FormData) => {
    setTried(true);
    if (blocked) return;
    let id = created.current;
    if (!id) {
      ({ id } = await saveProductFn({
        data: {
          id: null,
          product: {
            name: String(f.get("name") ?? "").trim(),
            description: String(f.get("description") ?? "").trim(),
            keywords: "",
            price: Number(f.get("price")) || 0,
            currency: shop.currency,
            countryPrices: {},
            categoryIds: [],
            isActive: true,
            sortOrder: 0,
            fulfillmentKind: "digital",
            stockQuantity: null,
            leadTimeDays: null,
            images: [],
            materials: [],
            variants: [],
            lowStockAt: null,
            preorderOn: false,
            preorderFrom: null,
            isCourse: true,
          },
        },
      }));
      created.current = id;
    }
    await saveCourseFn({
      data: {
        productId: id,
        course: {
          schedule: { mode: "all" },
          lessons: outline.lessons.map((l, i) => ({
            id: crypto.randomUUID(),
            title: l.title,
            text: "",
            files: [],
            link: l.link,
            ...(l.videos?.length ? { videos: l.videos } : {}),
            ...(free && i === 0 ? { preview: true } : {}),
          })),
        },
      },
    });
    await navigate({ to: "/admin/products/$id", params: { id } });
  });

  if (!shop.modules.courses || !canEdit(shop.role))
    return (
      <>
        <PageTitle title={t("courseWizard.title")} />
        <p className="text-sm text-muted">{t("courseWizard.noModule")}</p>
      </>
    );

  return (
    <>
      <PageTitle title={t("courseWizard.title")} subtitle={t("courseWizard.subtitle")} />
      <form
        id="course-wizard"
        className="max-w-2xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <Card>
          <div className="space-y-3">
            <Field label={t("courseWizard.name")}>
              <input className="input" name="name" required maxLength={200} />
            </Field>
            <Field label={t("courseWizard.price", { currency: shop.currency })}>
              <input
                className="input"
                name="price"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                required
              />
            </Field>
            <Field label={t("courseWizard.description")} hint={t("courseWizard.descriptionHint")}>
              <textarea className="input" name="description" rows={3} maxLength={4000} />
            </Field>
            <Field label={t("courseWizard.lessons")} hint={t("courseWizard.lessonsHint")}>
              <textarea
                id="course-wizard-lessons"
                className="input min-h-48 font-mono text-sm"
                value={text}
                placeholder={t("courseWizard.lessonsPlaceholder")}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            <ul className="space-y-0.5 text-xs text-muted" role="status">
              <li>{t("courseWizard.found", { n: outline.lessons.length, m: outline.modules })}</li>
              {outline.skipped.length > 0 && (
                <li className="text-danger">{t("courseWizard.fixLines")}</li>
              )}
              {outline.skipped.slice(0, 10).map((s) => (
                <li key={s.line} className="text-danger">
                  {reason(s)}
                </li>
              ))}
              {outline.overLimit > 0 && (
                <li className="text-danger">
                  {t("school.listOver", { n: outline.overLimit, max: LESSONS_MAX })}
                </li>
              )}
              {tried && outline.lessons.length === 0 && (
                <li className="text-danger">{t("courseWizard.needLessons")}</li>
              )}
            </ul>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id="course-wizard-free"
                checked={free}
                onChange={(e) => setFree(e.target.checked)}
              />
              {t("courseWizard.preview")}
            </label>
          </div>
        </Card>
        <ErrorBox error={create.error} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={create.busy}>
            {t("courseWizard.submit")}
          </button>
          <span className="text-xs text-muted">{t("courseWizard.after")}</span>
        </div>
        <Link
          to="/admin/products/$id"
          params={{ id: "new" }}
          className="inline-block text-sm text-muted underline"
        >
          {t("courseWizard.full")}
        </Link>
      </form>
    </>
  );
}
