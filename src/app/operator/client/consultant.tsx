/** Карточка клиента у оператора: консультант по прайсу — здоровье, модель, цена ответа. */
import { useEffect, useState, type FormEvent } from "react";
import { clientConsultantViewFn, setConsultantModelFn } from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import type { C } from "./types";

type View = NonNullable<Awaited<ReturnType<typeof clientConsultantViewFn>>>;
type Alert = View["overview"]["alerts"][number];

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("ru", { dateStyle: "short", timeStyle: "short" }) : "—";

/** Предупреждения «Обзора» продавца — словами для оператора. */
export function alertText(a: Alert): string {
  switch (a.key) {
    case "disabled":
      return "Консультант выключен у продавца.";
    case "pricelistNone":
      return "Прайс пуст — консультант не знает товаров.";
    case "pricelistStale":
      return `Прайс не обновлялся ${a.days} дн.`;
    case "sheetFailing":
      return "Google Таблица с прайсом не читается.";
    case "rateNone":
      return "Курса рубля нет.";
    case "rateStale":
      return "Курс рубля устарел.";
    case "limitNear":
      return `Дневной предел почти исчерпан: $${a.usd.toFixed(2)} из $${a.limit}.`;
    case "limitReached":
      return `Дневной предел $${a.limit} исчерпан — вопросы уходят менеджеру.`;
    case "modelFailing":
      return `Модель сбоит (${when(a.at)}): ${a.error}`;
    case "chatOff":
      return "Модуль «Чат» выключен — передачи не видны в «Диалогах».";
    case "untaggedArticles":
      return `Статей без тегов: ${a.n}.`;
  }
}

export function ConsultantViewCard({ c }: { c: C }) {
  const [view, setView] = useState<View | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let off = false;
    setError(null);
    clientConsultantViewFn({ data: { botId: c.id } })
      .then((v) => !off && setView(v))
      .catch((e) => !off && setError(e));
    return () => {
      off = true;
    };
  }, [c.id, nonce]);
  const refresh = () => setNonce((n) => n + 1);
  const save = useAction(async (model: string) => {
    await setConsultantModelFn({ data: { botId: c.id, model } });
    refresh();
  });

  if (view === null) return null;
  return (
    <Card
      title="Консультант по прайсу"
      actions={
        <button className="btn-secondary text-xs" onClick={refresh}>
          Обновить
        </button>
      }
    >
      {!view ? (
        !error && <p className="text-sm text-muted">Загрузка…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <Health v={view} />
          <form
            className="space-y-2 border-t border-line pt-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const m = String(new FormData(e.currentTarget).get("model") ?? "");
              void save.run(m).catch(() => {});
            }}
          >
            <p>
              Отвечает на <b>{view.model.effective}</b>
              {view.model.stored === "" && " (модель платформы)"}.{" "}
              {view.model.unknown && (
                <Badge tone="danger">в настройке «{view.model.stored}» — такой модели нет</Badge>
              )}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Модель">
                <select
                  className="input"
                  name="model"
                  key={view.model.stored}
                  defaultValue={view.model.unknown ? "" : view.model.stored}
                >
                  <option value="">модель платформы ({view.model.platform})</option>
                  {view.model.options.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <button className="btn-secondary" disabled={save.busy}>
                Сохранить модель
              </button>
            </div>
            <p className="text-xs text-muted">
              Смена модели действует со следующего ответа. В списке только модели, на которых
              консультант проверен.
            </p>
            <ErrorBox error={save.error} />
          </form>
          <Week v={view} />
        </div>
      )}
      <ErrorBox error={error} />
    </Card>
  );
}

function Health({ v }: { v: View }) {
  const o = v.overview;
  // Ошибка модели — строкой выше, целиком.
  const alerts = o.alerts.filter((a) => a.key !== "modelFailing");
  const week = o.week.reduce(
    (s, d) => ({ replies: s.replies + d.replies, handoffs: s.handoffs + d.handoffs }),
    { replies: 0, handoffs: 0 },
  );
  return (
    <>
      <p>
        {o.enabled ? <Badge tone="ok">включён</Badge> : <Badge tone="warn">выключен</Badge>} Сегодня
        ответов {o.today.replies}, передач {o.today.handoffs}, без ответа {o.today.silent}; за 7
        дней ответов {week.replies}, передач {week.handoffs}. Открытых задач {o.tasks?.open ?? "—"}.
      </p>
      <p>
        Прайс: {o.pricelist.count} поз., обновлён {when(o.pricelist.at)}. Курс рубля:{" "}
        {o.rate
          ? `${o.rate.rate} от ${when(o.rate.updatedAt)}${o.rate.fresh ? "" : " (устарел)"}`
          : "нет"}
        . Расход сегодня (UTC) ${o.spend.usd.toFixed(2)} из ${o.spend.limitUsd}.
      </p>
      <p>
        Последняя ошибка:{" "}
        {v.lastError ? (
          <>
            {when(v.lastError.at)} — {v.lastError.detail}{" "}
            {v.lastError.transient && <Badge tone="warn">сбой Anthropic</Badge>}
          </>
        ) : (
          "нет"
        )}
      </p>
      {alerts.length > 0 && (
        <ul className="list-disc pl-5 text-warn">
          {alerts.map((a) => (
            <li key={a.key}>{alertText(a)}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function Week({ v }: { v: View }) {
  if (!v.week.length) return <p className="text-muted">За 7 дней консультант модель не вызывал.</p>;
  return (
    <div className="overflow-x-auto border-t border-line pt-3">
      <table className="table">
        <thead>
          <tr>
            <th>Модель, 7 дней</th>
            <th>Ходов</th>
            <th>Расход</th>
            <th>Цена хода</th>
          </tr>
        </thead>
        <tbody>
          {v.week.map((w) => (
            <tr key={w.model}>
              <td>{w.model}</td>
              <td>{w.runs}</td>
              <td>${w.usd.toFixed(2)}</td>
              <td>${w.avgUsd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
