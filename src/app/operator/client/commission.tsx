/** Комиссия платформы у оператора: дата начала у клиента. Общий выключатель — в «Настройках». */
import { useEffect, useState } from "react";
import {
  commissionSwitchFn,
  setCommissionStartFn,
  setCommissionSwitchFn,
} from "@/app/operator/client-plans.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

export function CommissionStartCard({
  c,
  start,
  billed,
}: {
  c: C;
  start: string | null;
  billed: Array<{ month: string; invoiceId: string }>;
}) {
  const [sw, setSw] = useState<Awaited<ReturnType<typeof commissionSwitchFn>> | null>(null);
  const [value, setValue] = useState(start ?? "");
  const [saved, setSaved] = useState<string | null>(start);
  useEffect(() => {
    void commissionSwitchFn().then(setSw);
  }, []);
  const save = useAction(async (next: string | null) => {
    const r = await setCommissionStartFn({ data: { botId: c.id, start: next } });
    setSaved(r.start);
    setValue(r.start ?? "");
  });
  return (
    <Card
      title="Комиссия платформы"
      actions={
        sw && (
          <Badge tone={sw.enabled ? "ok" : undefined}>
            {sw.enabled ? "включена" : "выключена"}
          </Badge>
        )
      }
    >
      <p className="mb-2 text-sm text-muted">
        Начисляется только при включённом общем выключателе (раздел «Настройки»): комиссия за
        прошедший месяц входит строкой в следующий счёт за подписку. Дата начала:
        {saved ? ` ${saved}` : ` общая${sw ? ` (${sw.defaultStart})` : ""}`}.
      </p>
      {billed.length > 0 && (
        <p className="mb-2 text-sm text-muted">
          Уже в счетах:{" "}
          {billed.map((b) => `${b.month} (счёт ${b.invoiceId.slice(0, 8)})`).join(", ")}. Отменённый
          или отклонённый счёт месяц освобождает.
        </p>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(value || null).catch(() => {});
        }}
      >
        <input
          className="input w-44"
          type="date"
          value={value}
          aria-label="Дата начала комиссии"
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn-secondary" disabled={save.busy || (value || null) === saved}>
          Сохранить дату
        </button>
        {saved && (
          <button
            type="button"
            className="btn-secondary"
            disabled={save.busy}
            onClick={() => void save.run(null).catch(() => {})}
          >
            Вернуть общую дату
          </button>
        )}
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}

/** Общий выключатель комиссии платформы: по умолчанию выключен, включает оператор по слову Якова. */
export function CommissionSwitchCard() {
  const [sw, setSw] = useState<Awaited<ReturnType<typeof commissionSwitchFn>> | null>(null);
  useEffect(() => {
    void commissionSwitchFn().then(setSw);
  }, []);
  const set = useAction(async (enabled: boolean) => {
    const r = await setCommissionSwitchFn({ data: { enabled } });
    setSw((cur) => (cur ? { ...cur, enabled: r.enabled } : cur));
  });
  if (!sw) return null;
  return (
    <Card
      title="Комиссия платформы"
      actions={
        <Badge tone={sw.enabled ? "ok" : undefined}>{sw.enabled ? "включена" : "выключена"}</Badge>
      }
    >
      <p className="mb-3 text-sm text-muted">
        10 % Базовый, 5 % Про, 1 % Бизнес с оплаченных заказов витрины и маркета, первые 50 000 ₸ в
        месяц без комиссии. Пока выключатель выключен, комиссия нигде не начисляется и продавцам
        показано «пока не начисляется». Включайте только по слову Якова. Общая дата начала для
        клиентов без своей: {sw.defaultStart}.
      </p>
      <button
        type="button"
        className={sw.enabled ? "btn-secondary" : "btn-primary"}
        disabled={set.busy}
        onClick={() => {
          const next = !sw.enabled;
          if (next && !window.confirm("Включить комиссию платформы для всех клиентов?")) return;
          void set.run(next).catch(() => {});
        }}
      >
        {sw.enabled ? "Выключить комиссию" : "Включить комиссию"}
      </button>
      <ErrorBox error={set.error} />
    </Card>
  );
}
