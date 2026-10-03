import { CourseFunnel } from "@/app/admin/course-funnel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { schoolStudentsFn } from "@/app/admin/courses.functions";
import { Badge, Card, Empty, PageTitle } from "@/app/ui";
import { adminT } from "@/app/i18n/admin";
import { canEdit } from "@/core/auth/roles";

/**
 * «Ученики» онлайн-школы: все ученики всех курсов — поток, тариф,
 * прогресс, задания, кто отстаёт. Исключить из канала и прочие действия —
 * в карточке курса.
 */
export const Route = createFileRoute("/admin/_authed/students")({
  loader: () => schoolStudentsFn(),
  component: StudentsPage,
});

function StudentsPage() {
  const courses = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [onlyBehind, setOnlyBehind] = useState(false);
  const [course, setCourse] = useState("");
  const shown = courses.filter((c) => !course || c.productId === course);
  const total = courses.reduce((n, c) => n + c.students.length, 0);
  return (
    <>
      <PageTitle title={t("students.title")} subtitle={t("students.subtitle", { n: total })} />
      {courses.length === 0 ? (
        <Empty>
          {t("students.noCourses")}{" "}
          <Link
            to="/admin/products/$id"
            params={{ id: "new" }}
            className="text-accent hover:underline"
          >
            {t("products.addFirstCourse")}
          </Link>
        </Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            {courses.length > 1 && (
              <select
                className="input w-auto"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
              >
                <option value="">{t("students.allCourses")}</option>
                {courses.map((c) => (
                  <option key={c.productId} value={c.productId}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={onlyBehind}
                onChange={(e) => setOnlyBehind(e.target.checked)}
              />
              {t("product.studentBehindOnly")}
            </label>
            {canEdit(shop.role) && (
              <a
                className="btn-secondary text-xs"
                href={`/api/admin/export/students${course ? `?productId=${course}` : ""}`}
              >
                {t("common.downloadCsv")}
              </a>
            )}
          </div>
          <div className="space-y-4">
            {shown.map((c) => {
              const list = c.students.filter((s) => !onlyBehind || s.behind);
              return (
                <Card
                  key={c.productId}
                  title={
                    <Link
                      to="/admin/products/$id"
                      params={{ id: c.productId }}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                  }
                  actions={<Badge>{list.length}</Badge>}
                >
                  {list.length === 0 ? (
                    <p className="text-sm text-muted">{t("product.courseStudentsEmpty")}</p>
                  ) : (
                    <ul className="divide-y divide-line text-sm">
                      {list.map((s) => (
                        <li
                          key={s.orderItemId}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {s.buyer ?? `#${s.orderNo}`}
                            {s.tariff ? ` · ${s.tariff}` : ""}
                            {s.cohort ? ` · ${s.cohort}` : ""}
                          </span>
                          {s.behind && (
                            <span className="badge text-xs text-warn">
                              {t("product.studentBehind")}
                            </span>
                          )}
                          {s.expired && (
                            <span className="badge text-xs">{t("product.studentExpired")}</span>
                          )}
                          <span className="shrink-0 text-xs text-muted tabular-nums">
                            {s.startedAt
                              ? t("product.courseProgress", {
                                  done: s.done,
                                  total: c.total,
                                  open: s.open,
                                })
                              : t("product.courseNotStarted")}
                            {s.homework.submitted + s.homework.accepted + s.homework.revise > 0 &&
                              ` · 📝 ${t("product.studentHomework", {
                                accepted: s.homework.accepted,
                                waiting: s.homework.submitted,
                                revise: s.homework.revise,
                              })}`}
                            {s.quiz.lessons > 0 &&
                              ` · 🧪 ${t("school.studentQuiz", {
                                passed: s.quiz.passed,
                                lessons: s.quiz.lessons,
                                attempts: s.quiz.attempts,
                              })}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <CourseFunnel productId={c.productId} t={t} />
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
