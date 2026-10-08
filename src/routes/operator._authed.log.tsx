import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { allEventsFn } from "@/app/operator/platform.functions";
import { listClientsFn } from "@/app/operator/clients.functions";
import { shopEventView } from "@/app/admin/audit-labels";
import { Badge, Empty, PageTitle } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/log")({
  validateSearch: z.object({
    botId: z.string().optional(),
    kind: z.string().optional(),
    who: z.enum(["shop", "platform"]).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [events, clients] = await Promise.all([
      allEventsFn({
        data: { botId: deps.botId ?? null, kind: deps.kind ?? null, who: deps.who ?? null },
      }),
      listClientsFn(),
    ]);
    return { events, clients: clients.map((c) => ({ id: c.id, name: c.name })) };
  },
  component: LogPage,
});

const KINDS: Array<[string, string]> = [
  ["module_on", "модуль включён"],
  ["module_off", "модуль выключен"],
  ["pause", "пауза"],
  ["resume", "возобновление"],
  ["suspend", "приостановка"],
  ["onboard", "подключение"],
  ["webhook", "вебхук / переезд"],
  ["meta", "карточка клиента"],
  ["payment", "платёж"],
  ["policy", "политика просрочки"],
  ["message", "сообщение владельцу"],
];
const KIND_LABEL = new Map(KINDS);

function summarize(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return Object.entries(payload as Record<string, unknown>)
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 240);
}

/** Журнал действий оператора по всем клиентам — что и когда делали с платформой. */
function LogPage() {
  const { events, clients } = Route.useLoaderData();
  const s = Route.useSearch();
  const navigate = useNavigate();
  return (
    <>
      <PageTitle title="Журнал действий" subtitle="Последние 200 событий по всем клиентам" />
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className="input w-64"
          value={s.botId ?? ""}
          onChange={(e) =>
            void navigate({
              to: "/operator/log",
              search: { ...s, botId: e.target.value || undefined },
            })
          }
        >
          <option value="">Все клиенты</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="input w-56"
          value={s.who ?? ""}
          onChange={(e) =>
            void navigate({
              to: "/operator/log",
              search: {
                ...s,
                who: (e.target.value || undefined) as "shop" | "platform" | undefined,
              },
            })
          }
        >
          <option value="">Все исполнители</option>
          <option value="platform">Оператор и платформа</option>
          <option value="shop">Команда магазина</option>
        </select>
        <select
          className="input w-56"
          value={s.kind ?? ""}
          onChange={(e) =>
            void navigate({
              to: "/operator/log",
              search: { ...s, kind: e.target.value || undefined },
            })
          }
        >
          <option value="">Все события</option>
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {events.length === 0 ? (
        <Empty>Событий нет.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Клиент</th>
                <th>Кто</th>
                <th>Событие</th>
                <th>Подробности</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-muted">
                    {new Date(e.at).toLocaleString("ru", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td>
                    <Link
                      to="/operator/clients/$botId"
                      params={{ botId: e.botId }}
                      className="hover:underline"
                    >
                      {e.botName}
                    </Link>
                  </td>
                  <td className="text-muted">{e.actor}</td>
                  <td>
                    <Badge>{shopEventView(e)?.title ?? KIND_LABEL.get(e.kind) ?? e.kind}</Badge>
                  </td>
                  <td
                    className="max-w-md truncate text-xs text-muted"
                    title={shopEventView(e)?.details ?? summarize(e.payload)}
                  >
                    {shopEventView(e)?.details ?? summarize(e.payload)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
