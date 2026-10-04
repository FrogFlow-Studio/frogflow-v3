import { createFileRoute } from "@tanstack/react-router";
import { marketOverviewFn } from "@/app/operator/operator.functions";
import { Card, Empty, PageTitle } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/market-stats")({
  loader: () => marketOverviewFn(),
  component: MarketStatsPage,
});

/** Аналитика площадки: откуда приходят покупатели и что ищут. Без личных данных, за 30 дней. */
function MarketStatsPage() {
  const s = Route.useLoaderData();
  if (!s)
    return (
      <div>
        <PageTitle title="Аналитика площадки" />
        <Empty>Нет данных: счётчик заработает после применения миграции 19-20.</Empty>
      </div>
    );
  const list = (rows: { query: string; count: number }[]) =>
    rows.length === 0 ? (
      <Empty>Пока пусто.</Empty>
    ) : (
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.query} className="flex justify-between gap-3">
            <span>{r.query}</span>
            <span className="text-muted">{r.count}</span>
          </li>
        ))}
      </ul>
    );
  const idle = s.shops.filter((x) => x.clicks === 0);
  return (
    <div className="space-y-4">
      <PageTitle title="Аналитика площадки" />
      <p className="text-sm text-muted">
        За {s.days} дней. Личные данные не храним: один человек за час считается один раз.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card title="Посещений /market">
          <div className="text-2xl font-semibold" data-testid="market-visits">
            {s.visits}
          </div>
        </Card>
        <Card title="Поисков">
          <div className="text-2xl font-semibold">{s.searches}</div>
        </Card>
        <Card title="Переходов в магазины">
          <div className="text-2xl font-semibold">{s.clicks}</div>
        </Card>
      </div>
      <Card title="Популярные поиски">{list(s.topSearches)}</Card>
      <Card title="Искали, но не нашли">{list(s.emptySearches)}</Card>
      <Card title="Магазины без переходов">
        {idle.length === 0 ? (
          <Empty>У всех магазинов на площадке есть переходы.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {idle.map((x) => (
              <li key={x.id}>{x.name}</li>
            ))}
          </ul>
        )}
      </Card>
      {s.otherClicks > 0 && (
        <p className="text-xs text-muted">
          Ещё {s.otherClicks} переходов в магазины, которых сейчас нет на площадке.
        </p>
      )}
    </div>
  );
}
