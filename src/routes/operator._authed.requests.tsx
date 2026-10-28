import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { moduleRequestsFn, resolveModuleRequestFn } from "@/app/operator/owner-messages.functions";
import { Badge, Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";

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
      {requests.length === 0 ? (
        <Empty>Открытых заявок нет.</Empty>
      ) : (
        <div className="operator-request-queue">
          {requests.map((r) => (
            <article className="operator-request" key={r.id}>
              <div>
                <Link
                  to="/operator/clients/$botId"
                  params={{ botId: r.botId }}
                  className="operator-client-name"
                >
                  {r.clientName}
                </Link>
                <p className="text-xs text-muted">{new Date(r.requestedAt).toLocaleString("ru")}</p>
              </div>
              <div>
                <h2>{r.moduleTitle}</h2>
                <p className="text-sm text-muted">
                  {r.price === null ? "Входит в базу" : `${r.price.toLocaleString("ru")} ₸`}
                </p>
                {r.alreadyOn && <Badge tone="ok">уже включён</Badge>}
              </div>
              <div className="operator-request-actions">
                <button
                  className="btn-primary"
                  disabled={act.busy}
                  onClick={() => void act.run(r.id, "enable").catch(() => {})}
                >
                  {r.alreadyOn ? "Закрыть заявку" : "Включить"}
                </button>
                <button
                  className="btn-ghost"
                  disabled={act.busy}
                  onClick={() => void act.run(r.id, "dismiss").catch(() => {})}
                >
                  Снять
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
