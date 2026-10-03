import { useState } from "react";
import { courseFunnelFn, funnelStudentsFn } from "@/app/admin/courses.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";
import type { FunnelKind } from "@/core/courses/funnel";

/**
 * «Где отваливаются»: воронка курса по потоку. По урокам — сколько открыли,
 * сдали задание, прошли; в конце — прошли курс. Клик по цифре — список
 * учеников шага. Сбой чтения — ошибка, а не нули.
 */
type Funnel = Awaited<ReturnType<typeof courseFunnelFn>>;
type People = Awaited<ReturnType<typeof funnelStudentsFn>>;
type Pick = { kind: FunnelKind; lessonNo: number; label: string };

export function CourseFunnel({ productId, t }: { productId: string; t: AdminT }) {
  const [open, setOpen] = useState(false);
  const [cohortId, setCohortId] = useState<string | null>(null);
  const [data, setData] = useState<Funnel | null>(null);
  const [picked, setPicked] = useState<{ pick: Pick; people: People } | null>(null);
  const load = useAction(async (cohort: string | null) => {
    setPicked(null);
    setData(await courseFunnelFn({ data: { productId, cohortId: cohort } }));
  });
  const show = useAction(async (pick: Pick) => {
    const people = await funnelStudentsFn({
      data: { productId, cohortId, kind: pick.kind, lessonNo: pick.lessonNo },
    });
    setPicked({ pick, people });
  });
  const cell = (n: number, pick: Pick) => {
    const share = data && data.students ? Math.round((n / data.students) * 100) : 0;
    return (
      <button
        type="button"
        className="tabular-nums underline-offset-2 hover:underline disabled:no-underline"
        disabled={n === 0 || show.busy}
        onClick={() => void show.run(pick).catch(() => {})}
      >
        {n} <span className="text-xs text-muted">({share}%)</span>
      </button>
    );
  };
  return (
    <details
      className="mt-3 rounded border border-line p-3 text-sm"
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(o);
        if (o && !data) void load.run(null).catch(() => {});
      }}
    >
      <summary className="cursor-pointer font-medium">{t("school.funnelTitle")}</summary>
      <p className="mt-2 text-xs text-muted">{t("school.funnelHint")}</p>
      <ErrorBox error={load.error ?? show.error} />
      {data && (
        <div className="mt-2 space-y-2">
          {data.cohorts.length > 0 && (
            <label className="flex items-center gap-2 text-xs">
              {t("school.funnelCohort")}
              <select
                className="input w-auto"
                value={cohortId ?? ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  setCohortId(next);
                  void load.run(next).catch(() => {});
                }}
              >
                <option value="">{t("school.funnelAllCohorts")}</option>
                {data.cohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title || "—"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {data.students === 0 ? (
            <p className="text-muted">{t("school.funnelEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-normal">{t("school.funnelLesson")}</th>
                    <th className="py-1 pr-3 font-normal">{t("school.funnelOpened")}</th>
                    <th className="py-1 pr-3 font-normal">{t("school.funnelHomework")}</th>
                    <th className="py-1 font-normal">{t("school.funnelDone")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lessons.map((l) => (
                    <tr key={l.no} className="border-t border-line">
                      <td className="py-1 pr-3">
                        {l.no}. {l.title}
                      </td>
                      <td className="py-1 pr-3">
                        {cell(l.opened, {
                          kind: "opened",
                          lessonNo: l.no,
                          label: t("school.funnelOpenedOf", { no: l.no }),
                        })}
                      </td>
                      <td className="py-1 pr-3">
                        {l.hasHomework ? (
                          cell(l.homework, {
                            kind: "homework",
                            lessonNo: l.no,
                            label: t("school.funnelHomeworkOf", { no: l.no }),
                          })
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="py-1">
                        {cell(l.done, {
                          kind: "done",
                          lessonNo: l.no,
                          label: t("school.funnelDoneOf", { no: l.no }),
                        })}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-line font-medium">
                    <td className="py-1 pr-3">{t("school.funnelFinished")}</td>
                    <td className="py-1 pr-3" colSpan={3}>
                      {cell(data.finished, {
                        kind: "finished",
                        lessonNo: 0,
                        label: t("school.funnelFinished"),
                      })}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-1 text-xs text-muted">
                {t("school.funnelOf", { n: data.students })}
              </p>
            </div>
          )}
          {picked && (
            <div className="rounded bg-surface-2 p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  {picked.pick.label} · {picked.people.length}
                </p>
                <button type="button" className="btn-ghost text-xs" onClick={() => setPicked(null)}>
                  {t("common.close")}
                </button>
              </div>
              <ul className="mt-1 space-y-0.5">
                {picked.people.map((p) => (
                  <li key={p.orderItemId}>{p.buyer ?? `#${p.orderNo}`}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
