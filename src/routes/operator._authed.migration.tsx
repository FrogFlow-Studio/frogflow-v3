import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { preflightAllFn, setServedByBulkFn } from "@/app/operator/platform.functions";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/migration")({
  loader: () => preflightAllFn(),
  component: MigrationPage,
});

/**
 * Массовый переезд: предполётная проверка всех клиентов на v1, выбор готовых,
 * одно нажатие. Каждый клиент проходит ту же проверку, что и в карточке —
 * неготового кнопка не переведёт.
 */
function MigrationPage() {
  const candidates = Route.useLoaderData();
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Awaited<ReturnType<typeof setServedByBulkFn>> | null>(null);
  const ready = candidates.filter((c) => c.ready);
  const move = useAction(async () => {
    const ids = [...picked];
    if (!ids.length) return;
    if (
      !confirm(
        `Перевести ${ids.length} клиент(ов) на v2? Вебхуки Telegram переставятся на этот деплой.`,
      )
    )
      return;
    setResult(await setServedByBulkFn({ data: { botIds: ids } }));
    setPicked(new Set());
    await router.invalidate();
  });
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  return (
    <>
      <PageTitle
        title="Переезд на v2"
        subtitle={`${candidates.length} клиентов ещё на прежней платформе, готовы: ${ready.length}`}
        actions={
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              onClick={() => setPicked(new Set(ready.map((c) => c.id)))}
              disabled={!ready.length}
            >
              Выбрать готовых
            </button>
            <button
              className="btn-primary"
              disabled={move.busy || picked.size === 0}
              onClick={() => void move.run().catch(() => {})}
            >
              {move.busy ? "Переводим…" : `Перевести на v2 (${picked.size})`}
            </button>
          </div>
        }
      />
      <ErrorBox error={move.error} />
      {result && (
        <Card title="Итог" className="mb-4">
          <ul className="space-y-1 text-sm">
            {result.map((r) => {
              const c = candidates.find((x) => x.id === r.id);
              return (
                <li key={r.id}>
                  {r.ok ? <Badge tone="ok">переведён</Badge> : <Badge tone="danger">нет</Badge>}{" "}
                  {c?.name ?? r.id}
                  {r.error && <span className="text-muted"> — {r.error}</span>}
                  {r.note && <span className="text-muted"> — {r.note}</span>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {candidates.length === 0 ? (
        <Empty>Все клиенты уже на v2.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>Клиент</th>
                <th>Готовность</th>
                <th>Что мешает</th>
                <th>Предупреждения</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="checkbox"
                      disabled={!c.ready}
                      checked={picked.has(c.id)}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <Link
                      to="/operator/clients/$botId"
                      params={{ botId: c.id }}
                      className="font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td>
                    {c.ready ? (
                      <Badge tone="ok">готов</Badge>
                    ) : (
                      <Badge tone="danger">не готов</Badge>
                    )}
                  </td>
                  <td className="text-sm text-danger">{c.blockers.join("; ") || "—"}</td>
                  <td className="text-sm text-muted">{c.warnings.join("; ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
