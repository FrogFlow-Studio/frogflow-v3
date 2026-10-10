/**
 * Курс Продамуса продавца в карточке клиента (вкладка «Оплата»): по нему бот
 * показывает рубли рядом с тенге и считает рублёвые заказы для формы *.kz.
 */
import { useEffect, useState } from "react";
import { prodamusRateStateFn, setProdamusRateFn } from "@/app/operator/prodamus-rate.functions";
import { Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

type State = Awaited<ReturnType<typeof prodamusRateStateFn>>;

export function ProdamusRateCard({ c }: { c: C }) {
  const [st, setSt] = useState<State | null>(null);
  const [rate, setRate] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const load = useAction(async () => {
    const s = await prodamusRateStateFn({ data: { botId: c.id } });
    setSt(s);
    setRate(s.rate ?? "");
  });
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  const save = useAction(async () => {
    setNote(null);
    await setProdamusRateFn({ data: { botId: c.id, rate } });
    setNote("Курс сохранён.");
    await load.run().catch(() => {});
  });

  return (
    <Card title="Продамус: курс ₸ за 1 ₽">
      <p className="mb-2 text-sm text-muted">
        По этому курсу бот пишет рубли рядом с тенге («1700 ₸ / ≈476 ₽»), если у товара нет цены для
        России, и считает в тенге заказы в рублях для формы *.kz. Пусто — рубли не показываются.
      </p>
      {!st ? (
        <p className="text-sm text-muted">{load.busy ? "Загружаю…" : "Нет данных."}</p>
      ) : !st.servedByV2 ? (
        <p className="text-sm text-muted">Клиента обслуживает v1.</p>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run().catch(() => {});
          }}
        >
          <input
            className="input w-28"
            placeholder="3.573"
            aria-label="Курс Продамуса, ₸ за 1 ₽"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <button className="btn-secondary" disabled={save.busy}>
            Сохранить курс
          </button>
          <span className="text-xs text-muted">
            {st.enabled ? `Форма: ${st.formUrl ?? "не задана"}` : "Продамус у продавца выключен"}
          </span>
        </form>
      )}
      {note && <p className="mt-2 text-sm">{note}</p>}
      <ErrorBox error={load.error ?? save.error} />
    </Card>
  );
}
