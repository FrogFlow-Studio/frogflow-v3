import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { moduleRequestsFn, resolveModuleRequestFn } from "@/app/operator/operator.functions";
import { Badge, Card, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/requests")({
  loader: () => moduleRequestsFn(),
  component: RequestsPage,
});

/**
 * Единая очередь «Заказать подключение» со всех клиентов. Живая заявка — это
 * деньги; здесь её видно сразу и включить модуль можно на месте, не
 * переходя в карточку клиента.
 */
function RequestsPage() {
  const requests = Route.useLoaderData();
  const router = useRouter();
  const act = useAction(async (id: string, action: "enable" | "dismiss") => {
    if (action === "dismiss" && !confirm("Снять заявку с очереди без подключения?")) return;
    const r = await resolveModuleRequestFn({ data: { id, action } });
    if (action === "enable" && !r.notified)
      alert(
        "Модуль включён, но сообщение владельцу не ушло: у клиента нет бота или id администратора.",
      );
    await router.invalidate();
  });
  return (
    <>
      <PageTitle
        title="Заявки на модули"
        subtitle="Продавцы нажали «Заказать подключение» в своей админке. Включение — сразу отсюда, владелец получит сообщение в Telegram."
      />
      <ErrorBox error={act.error} />
      <Card>
        {requests.length === 0 ? (
          <Empty>Открытых заявок нет.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Клиент</th>
                <th>Модуль</th>
                <th className="text-right">Цена</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-muted">
                    {new Date(r.requestedAt).toLocaleString("ru")}
                  </td>
                  <td>
                    <Link
                      to="/operator/clients/$botId"
                      params={{ botId: r.botId }}
                      className="font-medium hover:underline"
                    >
                      {r.clientName}
                    </Link>
                  </td>
                  <td>
                    {r.moduleTitle} <span className="text-xs text-muted">{r.moduleKey}</span>{" "}
                    {r.alreadyOn && <Badge tone="ok">уже включён</Badge>}
                  </td>
                  <td className="text-right tabular-nums">
                    {r.price === null ? "в базе" : `${r.price.toLocaleString("ru")} ₸`}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      className="btn-primary text-xs"
                      disabled={act.busy}
                      onClick={() => void act.run(r.id, "enable").catch(() => {})}
                    >
                      {r.alreadyOn ? "Закрыть заявку" : "Включить"}
                    </button>
                    <button
                      className="btn-ghost ml-1 text-xs"
                      disabled={act.busy}
                      onClick={() => void act.run(r.id, "dismiss").catch(() => {})}
                    >
                      Снять
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
