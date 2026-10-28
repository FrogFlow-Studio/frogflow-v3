import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { communityReportsFn, resolveCommunityReportFn } from "@/app/operator/moderation.functions";
import { Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/community")({
  component: CommunityReportsPage,
});

type R = Extract<Awaited<ReturnType<typeof communityReportsFn>>, { soon: false }>;

/** Жалобы авторов на темы и ответы сообщества: скрыть запись или отклонить жалобу. */
function CommunityReportsPage() {
  const [data, setData] = useState<R | null>(null);
  const [soon, setSoon] = useState(false);
  const load = useAction(async (offset: number) => {
    const r = await communityReportsFn({ data: { offset } });
    if (r.soon) return setSoon(true);
    setData((prev) =>
      offset === 0 || !prev ? r : { ...r, reports: [...prev.reports, ...r.reports] },
    );
  });
  useEffect(() => {
    void load.run(0).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const resolve = useAction(async (id: string, action: "hide" | "dismiss" | "restore") => {
    await resolveCommunityReportFn({ data: { id, action } });
    await load.run(0);
  });
  return (
    <>
      <PageTitle title="Жалобы сообщества" />
      {!data && load.busy && (
        <p className="text-sm text-muted" role="status">
          Загружаем обращения…
        </p>
      )}
      <ErrorBox error={load.error ?? resolve.error} />
      {soon && <Empty>Таблицы сообщества ещё не созданы (миграция 19-2 не применена).</Empty>}
      {data && data.reports.length === 0 && <Empty>Открытых жалоб нет.</Empty>}
      {data && data.total > 0 && (
        <p className="mb-3 text-sm text-muted">Открытых жалоб: {data.total}</p>
      )}
      <div className="space-y-3">
        {data?.reports.map((r) => (
          <Card key={r.id} title={r.kind === "post" ? `Ответ в теме «${r.title}»` : r.title}>
            <p className="whitespace-pre-wrap text-sm">{r.text}</p>
            <p className="mt-2 text-xs text-muted">
              Автор: {r.author} · пожаловался: {r.reporter}
              {r.reason ? ` · причина: ${r.reason}` : ""}
              {r.hidden
                ? r.hiddenBy === "reports"
                  ? " · скрыто по жалобам"
                  : " · уже скрыто"
                : ""}
            </p>
            <div className="mt-2 flex gap-2">
              {!r.hidden && (
                <button
                  className="btn-secondary text-danger"
                  disabled={resolve.busy}
                  onClick={() => void resolve.run(r.id, "hide").catch(() => {})}
                >
                  Скрыть запись
                </button>
              )}
              {r.hidden && (
                <button
                  className="btn-secondary"
                  disabled={resolve.busy}
                  onClick={() => void resolve.run(r.id, "restore").catch(() => {})}
                >
                  Вернуть запись
                </button>
              )}
              <button
                className="btn-ghost"
                disabled={resolve.busy}
                onClick={() => void resolve.run(r.id, "dismiss").catch(() => {})}
              >
                {r.hidden ? "Закрыть жалобу" : "Отклонить"}
              </button>
            </div>
          </Card>
        ))}
      </div>
      {data?.next != null && (
        <button
          className="btn-secondary mt-3"
          disabled={load.busy}
          onClick={() => void load.run(data.next!).catch(() => {})}
        >
          Показать ещё
        </button>
      )}
    </>
  );
}
