import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { marketReportsFn, resolveMarketReportFn } from "@/app/operator/moderation.functions";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/market-reports")({
  component: MarketReportsPage,
});

type V = Awaited<ReturnType<typeof marketReportsFn>>;

const STATE: Record<V["reports"][number]["state"], string> = {
  visible: "виден на площадке",
  hidden: "уже скрыт",
  pending: "ждёт одобрения",
  off: "не на площадке",
  gone: "клиента нет",
};

/** Жалобы покупателей на магазины и товары площадки: скрыть магазин с площадки или отклонить жалобу. */
function MarketReportsPage() {
  const [data, setData] = useState<V | null>(null);
  const load = useAction(async (offset: number) => {
    const r = await marketReportsFn({ data: { offset } });
    setData((prev) =>
      offset === 0 || !prev ? r : { ...r, reports: [...prev.reports, ...r.reports] },
    );
  });
  useEffect(() => {
    void load.run(0).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const resolve = useAction(async (id: string, action: "hide" | "dismiss") => {
    await resolveMarketReportFn({ data: { id, action } });
    await load.run(0);
  });
  return (
    <>
      <PageTitle
        title="Жалобы на магазины"
        subtitle="Покупатели жалуются на площадке без входа; магазин жалобу не видит. «Скрыть» убирает магазин с площадки (витрина по своей ссылке работает), вернуть его можно в карточке клиента."
      />
      <ErrorBox error={load.error ?? resolve.error} />
      {data && data.reports.length === 0 && <Empty>Открытых жалоб нет.</Empty>}
      {data && data.total > 0 && (
        <p className="mb-3 text-sm text-muted">Открытых жалоб: {data.total}</p>
      )}
      <div className="space-y-3">
        {data?.reports.map((r) => (
          <Card key={r.id} title={r.product ? `${r.shop}: ${r.product}` : r.shop}>
            <p className="text-sm">
              <Badge tone={r.state === "visible" ? "warn" : "neutral"}>{STATE[r.state]}</Badge>{" "}
              Причина: {r.reasonLabel}
            </p>
            {r.text && <p className="mt-2 whitespace-pre-wrap text-sm">{r.text}</p>}
            <p className="mt-2 text-xs text-muted">{new Date(r.at).toLocaleString("ru")}</p>
            <div className="mt-2 flex gap-2">
              {r.state === "visible" && (
                <button
                  className="btn-secondary text-danger"
                  disabled={resolve.busy}
                  onClick={() => void resolve.run(r.id, "hide").catch(() => {})}
                >
                  Скрыть с площадки
                </button>
              )}
              <button
                className="btn-ghost"
                disabled={resolve.busy}
                onClick={() => void resolve.run(r.id, "dismiss").catch(() => {})}
              >
                {r.state === "visible" ? "Отклонить" : "Закрыть жалобу"}
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
