import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BULK_MODULES, confirmMatches, type BulkAction } from "@/app/operator/bulk";
import { planLabel } from "@/app/operator/client-health";
import { listClientsFn, runBulkFn } from "@/app/operator/operator.functions";
import { MODULES } from "@/core/modules/registry";
import { Badge, Card, ErrorBox, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/bulk")({
  loader: () => listClientsFn(),
  component: BulkPage,
});

type Kind = BulkAction["kind"];
type Report = Awaited<ReturnType<typeof runBulkFn>>["results"];
const TONE = { done: "ok", skipped: "neutral", failed: "danger", deferred: "warn" } as const;
const STATUS = { done: "сделано", skipped: "пропущен", failed: "ошибка", deferred: "отложен" };

/** Массовые действия: фильтр → действие → подтверждение числом клиентов → отчёт по каждому. */
function BulkPage() {
  const clients = Route.useLoaderData();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [served, setServed] = useState<"v2" | "all">("v2");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [tag, setTag] = useState("");
  const [kind, setKind] = useState<Kind>("message");
  const [text, setText] = useState("");
  const [days, setDays] = useState(7);
  const [module, setModule] = useState<string>(BULK_MODULES[0] ?? "");
  const [confirm, setConfirm] = useState("");
  const [batchId, setBatchId] = useState(() => crypto.randomUUID());
  const [report, setReport] = useState<Report | null>(null);

  const plans = useMemo(() => [...new Set(clients.map((c) => c.plan ?? ""))].sort(), [clients]);
  const tags = useMemo(() => [...new Set(clients.flatMap((c) => c.tags))].sort(), [clients]);
  const shown = clients.filter(
    (c) =>
      (!q || c.name.toLowerCase().includes(q.toLowerCase()) || c.slug?.includes(q.toLowerCase())) &&
      (served === "all" || c.servedBy === "v2") &&
      (!status || c.status === status) &&
      (!plan || (c.plan ?? "") === (plan === "-" ? "" : plan)) &&
      (!tag || c.tags.includes(tag)),
  );
  const action: BulkAction =
    kind === "message" ? { kind, text } : kind === "extend" ? { kind, days } : { kind, module };
  const ready =
    shown.length > 0 &&
    confirmMatches(confirm, shown.length) &&
    (kind !== "message" || text.trim().length > 0);

  const run = useAction(async () => {
    const r = await runBulkFn({
      data: { botIds: shown.map((c) => c.id), batchId, confirmCount: confirm, action },
    });
    setReport(r.results);
    setConfirm("");
    // Пока часть отложена, запуск тот же: сделанное не повторится. Всё разобрано — новый запуск.
    if (!r.results.some((x) => x.status === "deferred")) setBatchId(crypto.randomUUID());
    await router.invalidate();
  });

  return (
    <>
      <PageTitle
        title="Массовые действия"
        subtitle="Выберите клиентов фильтром, затем действие. Клиенты на прежней платформе (v1) пропускаются, каждое действие пишется в журнал клиента."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="1. Кого выбрать">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input col-span-2"
              placeholder="Название или адрес"
              aria-label="Поиск клиента"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="input"
              aria-label="Платформа"
              value={served}
              onChange={(e) => setServed(e.target.value as "v2" | "all")}
            >
              <option value="v2">Только на v2</option>
              <option value="all">Все (v1 будут пропущены)</option>
            </select>
            <select
              className="input"
              aria-label="Статус клиента"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Любой статус</option>
              <option value="active">Активен</option>
              <option value="paused">Пауза</option>
              <option value="suspended">Приостановлен</option>
            </select>
            <select
              className="input"
              aria-label="План клиента"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            >
              <option value="">Любой план</option>
              {plans.map((p) => (
                <option key={p || "-"} value={p || "-"}>
                  {planLabel(p || null)}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Метка клиента"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            >
              <option value="">Любая метка</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-3 text-sm">
            Выбрано клиентов: <b>{shown.length}</b>
          </p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-auto rounded-md border border-line p-2 text-sm">
            {shown.map((c) => (
              <li key={c.id}>
                {c.name} <span className="text-muted">· {c.servedBy ?? "—"}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="2. Что сделать">
          <select
            className="input"
            aria-label="Действие"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            <option value="message">Написать владельцам в Telegram (раз в день на клиента)</option>
            <option value="extend">Продлить тариф</option>
            <option value="module">Включить модуль</option>
          </select>
          {kind === "message" && (
            <textarea
              className="input mt-3 min-h-28"
              aria-label="Текст сообщения"
              placeholder="🐸 Обновление FrogFlow: …"
              value={text}
              maxLength={3500}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          {kind === "extend" && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              На дней (1–30)
              <input
                className="input w-24"
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
          )}
          {kind === "module" && (
            <select
              className="input mt-3"
              aria-label="Модуль"
              value={module}
              onChange={(e) => setModule(e.target.value)}
            >
              {BULK_MODULES.map((k) => (
                <option key={k} value={k}>
                  {MODULES[k].title}
                </option>
              ))}
            </select>
          )}
          <p className="mt-3 text-xs text-muted">
            {kind === "message" &&
              "Клиенту, которому сегодня уже писали массово, сообщение не уйдёт второй раз. Недошедшее не повторяется само."}
            {kind === "extend" &&
              "Пробный период — как кнопка в карточке; платящему добавляется платёж на 0 ₸ вплотную к сроку, он виден в платежах и журнале."}
            {kind === "module" &&
              "Включается, как в карточке клиента; зависимые модули проверяются."}
          </p>
          <label className="mt-4 block text-sm">
            Для подтверждения введите число клиентов — {shown.length}
            <input
              className="input mt-1 w-32"
              inputMode="numeric"
              aria-label="Число клиентов для подтверждения"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <ErrorBox error={run.error} />
          <button
            className="btn-primary mt-3"
            disabled={!ready || run.busy}
            onClick={() => void run.run().catch(() => {})}
          >
            {run.busy ? "Выполняю…" : "Выполнить"}
          </button>
        </Card>
      </div>
      {report && (
        <div className="mt-4">
          <Card title="Отчёт">
            <p className="mb-2 text-sm text-muted">
              {(Object.keys(STATUS) as Array<keyof typeof STATUS>)
                .map((s) => `${STATUS[s]}: ${report.filter((r) => r.status === s).length}`)
                .join(" · ")}
              {report.some((r) => r.status === "deferred") &&
                ". Нажмите «Выполнить» ещё раз — сделанное не повторится."}
            </p>
            <table className="table">
              <tbody>
                {report.map((r) => (
                  <tr key={r.botId}>
                    <td>{r.name}</td>
                    <td className="w-28">
                      <Badge tone={TONE[r.status]}>{STATUS[r.status]}</Badge>
                    </td>
                    <td className="text-sm text-muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
