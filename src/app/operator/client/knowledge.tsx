/**
 * Карточка раздела «Перенос»: база знаний консультанта. v1 писал статьи в
 * `app_settings` без явного bot_id, поэтому у переехавшего клиента они могут
 * лежать под чужим bot_id — оператор видит все такие строки и переносит нужную.
 */
import { useEffect, useState } from "react";
import {
  clientKnowledgeSourcesFn,
  importClientKnowledgeFn,
} from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import { ConfirmName } from "./ConfirmName";
import type { C } from "./types";

type Sources = Awaited<ReturnType<typeof clientKnowledgeSourcesFn>>;
type Source = Sources["others"][number];

export function KnowledgeImportCard({ c }: { c: C }) {
  const [data, setData] = useState<Sources | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const [asking, setAsking] = useState<Source | null>(null);
  useEffect(() => {
    let off = false;
    setError(null);
    clientKnowledgeSourcesFn({ data: { botId: c.id } })
      .then((r) => !off && setData(r))
      .catch((e) => !off && setError(e));
    return () => {
      off = true;
    };
  }, [c.id, nonce]);
  const refresh = () => setNonce((n) => n + 1);
  // Пока клиент на v1, его строку статей читает прежняя платформа — перенос закрыт.
  const onV2 = c.servedBy === "v2";
  const run = useAction(async (sourceBotId: string) => {
    setDone(null);
    const r = await importClientKnowledgeFn({ data: { botId: c.id, sourceBotId } });
    setDone(
      `Перенесено: добавлено ${r.added}, обновлено ${r.updated}. Всего статей у клиента: ${r.total}.`,
    );
    setAsking(null);
    refresh();
  });
  return (
    <Card
      title="База знаний консультанта"
      actions={
        <button className="btn-secondary text-xs" onClick={refresh}>
          Обновить
        </button>
      }
    >
      <p className="text-sm">
        {data
          ? data.defaults
            ? `У клиента нет своих статей — консультант отвечает по стандартным (${data.current}).`
            : `У клиента ${data.current} статей.`
          : "Загрузка…"}
      </p>
      <p className="mt-1 text-xs text-muted">
        Строки базы знаний всех клиентов: v1 сохранял статьи без явного bot_id, поэтому статьи
        переехавшего клиента могут лежать под чужим. Перенос дописывает статьи этому клиенту
        (строка-источник не меняется): одинаковые заголовки обновляются, повторный перенос дублей не
        делает.
      </p>
      {!onV2 && (
        <p className="mt-1 text-xs text-warn">
          Клиент ещё на прежней платформе (v1): сначала переключите обслуживание на v2 — иначе
          перенос изменил бы ответы живого бота v1.
        </p>
      )}
      {done && <p className="mt-2 text-xs text-ok">{done}</p>}
      <ErrorBox error={error ?? run.error} />
      {data &&
        (data.others.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Других строк с базой знаний в базе нет — переносить нечего.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1">Клиент</th>
                  <th>Статей</th>
                  <th>Заголовки</th>
                  <th>Изменено</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.others.map((s) => (
                  <tr key={s.botId} className="border-t border-line align-top">
                    <td className="py-1.5">
                      <div className="font-medium">{s.botName ?? "клиент не найден"}</div>
                      <div className="font-mono text-muted">{s.botId}</div>
                      {s.archived && <Badge tone="warn">в архиве</Badge>}
                    </td>
                    <td className="py-1.5">
                      {s.broken ? <Badge tone="danger">испорчено</Badge> : s.articles}
                    </td>
                    <td className="max-w-sm py-1.5 text-muted">
                      {s.titles.join(" · ") || "—"}
                      {s.articles > s.titles.length && ` … (+${s.articles - s.titles.length})`}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-muted">
                      {s.updatedAt ? new Date(s.updatedAt).toLocaleString("ru") : "—"}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        className="btn-secondary text-xs"
                        disabled={!onV2 || run.busy || s.broken || s.articles === 0}
                        onClick={() => setAsking(s)}
                      >
                        Перенести статьи в этого клиента
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {asking && (
        <ConfirmName
          name={c.name}
          title="Перенести статьи базы знаний?"
          text={`${asking.articles} статей из строки ${asking.botName ?? asking.botId} допишутся в базу знаний клиента. Статьи с теми же заголовками обновятся, строка-источник не изменится.`}
          confirmLabel="Перенести статьи"
          onConfirm={() => run.run(asking.botId)}
          onCancel={() => setAsking(null)}
        />
      )}
    </Card>
  );
}
