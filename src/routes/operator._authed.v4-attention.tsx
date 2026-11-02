import { createFileRoute } from "@tanstack/react-router";
import { v4AttentionFn } from "@/app/operator/v4-attention.functions";
import { Badge, Card, Empty, PageTitle } from "@/app/ui";
import type { Light } from "@/v4/screens/screens";

/**
 * «Внимание (v4)»: дела, поднятые оператору, и светофор магазинов новой
 * версии. Только просмотр; пока магазинов в v4 нет, страница пустая.
 */
export const Route = createFileRoute("/operator/_authed/v4-attention")({
  loader: () => v4AttentionFn(),
  component: V4AttentionPage,
});

const DOT: Record<Light, string> = { red: "🔴", yellow: "🟡", green: "🟢" };
const TONE: Record<Light, "danger" | "warn" | "ok"> = {
  red: "danger",
  yellow: "warn",
  green: "ok",
};

function V4AttentionPage() {
  const view = Route.useLoaderData();
  const fmt = (d: Date) =>
    new Date(d).toLocaleString("ru", { dateStyle: "short", timeStyle: "short" });
  if (view.state === "not_connected")
    return (
      <>
        <PageTitle title="Внимание (v4)" />
        <Empty>
          Схема v4 не открыта в Supabase (Settings → API → Exposed schemas). Клиенты работают на v3,
          как раньше.
        </Empty>
      </>
    );
  const name = (id: string) => view.names[id] ?? id.slice(0, 8);
  return (
    <>
      <PageTitle
        title="Внимание (v4)"
        subtitle="Дела, поднятые оператору, и светофор магазинов новой версии"
      />
      <Card title="Дела оператора">
        {view.screen.cases.length === 0 ? (
          <Empty>Дел нет.</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {view.screen.cases.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span>{DOT[c.light]}</span>
                <b>{name(c.botId)}</b>
                <span>{c.title}</span>
                {c.orderNo != null ? <span className="text-muted">№{c.orderNo}</span> : null}
                <span className="text-muted">с {fmt(c.openedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="mt-4">
        <Card title="Магазины">
          {view.screen.shops.length === 0 ? (
            <Empty>В v4 пока нет ни одного магазина.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th>Магазин</th>
                  <th>Открытых дел</th>
                  <th>Заказов за 2 дня</th>
                  <th>ИИ осталось</th>
                </tr>
              </thead>
              <tbody>
                {view.screen.shops.map((s) => (
                  <tr key={s.botId}>
                    <td>
                      <Badge tone={TONE[s.light]}>{DOT[s.light]}</Badge> {name(s.botId)}
                    </td>
                    <td>{s.openCases}</td>
                    <td>{s.orders2d}</td>
                    <td>${(s.aiRoomMicroUsd / 1_000_000).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
