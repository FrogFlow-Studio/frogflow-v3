import { createFileRoute, useRouter } from "@tanstack/react-router";
import { observerOverviewFn, setObserverFn } from "@/app/operator/observer.functions";
import { Badge, Empty, ErrorBox, PageTitle, Switch, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/observer")({
  loader: () => observerOverviewFn(),
  component: ObserverPage,
});

const KIND: Record<string, string> = {
  off_topic: "не на то",
  double_reply: "дважды",
  unanswered: "без ответа",
  other_country: "другая страна",
  card_trouble: "не картой",
  payment_stuck: "оплата зависла",
  wholesale: "опт",
  upset: "недоволен",
  bug: "сбой",
};
const SENT: Record<string, string> = {
  seller: "продавцу",
  held: "не слали (час)",
  failed: "не ушло",
  system: "оператору",
  settled: "не слали: заказ оплачен",
};

/**
 * ИИ-наблюдатель (фаза 1): у кого включён, расход, последний прогон и
 * находки за сегодня и вчера — по ним неделю меряем точность.
 */
function ObserverPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const toggle = useAction(async (botId: string, enabled: boolean) => {
    await setObserverFn({ data: { botId, enabled } });
    await router.invalidate();
  });
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("ru", { dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <PageTitle
        title="Наблюдатель"
        subtitle={`Sonnet раз в 15 минут читает новые реплики и сообщает продавцу о проблемах; покупателям не пишет. Промпт ${data.version}`}
      />
      <ErrorBox error={toggle.error} />
      {data.clients.length === 0 && <Empty>Клиентов v2 нет</Empty>}
      {data.clients.map((c) => (
        <div key={c.botId} className="card mb-3">
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              checked={c.enabled}
              disabled={toggle.busy}
              label={`Наблюдатель: ${c.name}`}
              onChange={(v) => void toggle.run(c.botId, v).catch(() => undefined)}
            />
            <div className="font-medium">{c.name}</div>
            <div className="text-sm text-muted">
              сегодня {c.spentToday.toFixed(2)} $ из {c.cap.toFixed(2)} $
            </div>
            {c.last && (
              <div className="text-xs text-muted">
                прогон {fmt(c.last.at)}: модели показано {c.last.dialogs}
                {c.last.calm ? `, обычных пропущено ${c.last.calm}` : ""}, находок {c.last.findings}
                , продавцу {c.last.sent}
                {c.last.overflow ? `, сверх потолка ${c.last.overflow}` : ""}
                {c.last.failed ? `, не разобрано ${c.last.failed}` : ""}
              </div>
            )}
            {c.last?.error && <Badge tone="danger">{c.last.error}</Badge>}
          </div>
          {c.log.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Диалог</th>
                    <th>Что</th>
                    <th>Цитата и вывод</th>
                    <th>Ответ</th>
                    <th>Куда</th>
                  </tr>
                </thead>
                <tbody>
                  {c.log.map((e, i) => (
                    <tr key={`${e.at}-${e.tid}-${i}`}>
                      <td className="whitespace-nowrap text-muted">{fmt(e.at)}</td>
                      <td>
                        <a className="link" href={`/operator/clients/${c.botId}`}>
                          {e.who}
                        </a>
                      </td>
                      <td>
                        <Badge tone={e.kind === "bug" ? "danger" : "warn"}>
                          {KIND[e.kind] ?? e.kind}
                        </Badge>
                      </td>
                      <td className="max-w-md">
                        <div>«{e.quote}»</div>
                        <div className="text-xs text-muted">{e.summary}</div>
                      </td>
                      <td className="max-w-sm text-xs">{e.reply}</td>
                      <td className="whitespace-nowrap text-xs text-muted">
                        {SENT[e.sent] ?? e.sent}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
