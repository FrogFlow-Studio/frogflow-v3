/**
 * Kaspi через ApiPay у оператора: подключение продавца (карточка клиента,
 * вкладка «Оплата») и партнёрский ключ платформы (раздел «Настройки»).
 */
import { useEffect, useState } from "react";
import {
  apipayClientStateFn,
  apipayCreateOrgFn,
  apipayIssueKeyFn,
  apipayKycLinkFn,
  apipayPartnerKeyStateFn,
  apipayPayTariffFn,
  apipayPlansFn,
  apipaySendCashierPhoneFn,
  apipayVerifyCashierFn,
  setApipayPartnerKeyFn,
} from "@/app/operator/apipay-partner.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

type State = Awaited<ReturnType<typeof apipayClientStateFn>>;

const step = (done: boolean, text: string) => (
  <li className="flex items-center gap-2">
    <Badge tone={done ? "ok" : undefined}>{done ? "готово" : "нет"}</Badge>
    {text}
  </li>
);

export function ApipayCard({ c }: { c: C }) {
  const [st, setSt] = useState<State | null>(null);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [smsSent, setSmsSent] = useState(false);
  const [kycUrl, setKycUrl] = useState<string | null>(null);
  const [plans, setPlans] = useState<Array<{ id: string; label: string }>>([]);
  const [tier, setTier] = useState("");
  const [months, setMonths] = useState(1);
  const [payer, setPayer] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const load = useAction(async () => setSt(await apipayClientStateFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  const act = useAction(async (fn: () => Promise<string | void>) => {
    setNote(null);
    const msg = await fn();
    if (msg) setNote(msg);
    await load.run().catch(() => {});
  });
  const go = (fn: () => Promise<string | void>) => void act.run(fn).catch(() => {});

  const org = st?.org ?? null;
  const cashier = st?.cashier?.connected === true || org?.kaspi_connected === true;
  const kycOk = st?.kyc?.status === "approved" || org?.kyc_status === "approved";
  // Пробный тариф (3 дня, 50 счетов в день) тоже рабочий; «none» — тарифа нет.
  const tariffOk = st?.tariff?.status === "active" || st?.tariff?.is_trial === true;

  return (
    <Card
      title="Kaspi через ApiPay"
      actions={
        st?.orgId && (
          <Badge tone={org?.is_test ? "warn" : "ok"}>{org?.is_test ? "песочница" : "боевой"}</Badge>
        )
      }
    >
      <p className="mb-2 text-sm text-muted">
        Покупатель платит по ссылке Kaspi, заказ подтверждается сам. Тариф ApiPay оплачивает
        продавец.
      </p>
      {!st ? (
        <p className="text-sm text-muted">{load.busy ? "Загружаю…" : "Нет данных."}</p>
      ) : !st.servedByV2 ? (
        <p className="text-sm text-muted">Клиента обслуживает v1 — подключать рано.</p>
      ) : !st.partner ? (
        <p className="text-sm text-muted">
          Партнёрский ключ ApiPay не задан: раздел «Настройки» → «ApiPay (Kaspi)».
        </p>
      ) : !st.orgId ? (
        <button
          className="btn-primary"
          disabled={act.busy}
          onClick={() =>
            go(async () => {
              await apipayCreateOrgFn({ data: { botId: c.id } });
            })
          }
        >
          Создать организацию в ApiPay
        </button>
      ) : (
        <div className="space-y-3 text-sm">
          {st.error && <p className="text-danger">{st.error}</p>}
          <ul className="space-y-1">
            {step(cashier, "Кассир Kaspi Pay привязан")}
            {step(kycOk, `Анкета ApiPay${st.kyc?.status ? ` (${st.kyc.status})` : ""}`)}
            {step(
              tariffOk,
              `Тариф ApiPay${st.tariff?.tier ? ` (${st.tariff.tier})` : ""}${st.tariff?.is_trial ? ", пробный" : ""}${st.tariff?.days_remaining != null ? `, осталось дней: ${st.tariff.days_remaining}` : ""}`,
            )}
            {step(st.keyIssued, "Ключ и вебхук у продавца")}
            {step(st.moduleOn, "Модуль «Kaspi Pay» включён (вкладка «Обзор» → модули)")}
          </ul>

          {!cashier && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!smsSent)
                  go(async () => {
                    await apipaySendCashierPhoneFn({ data: { botId: c.id, phone } });
                    setSmsSent(true);
                    return "SMS с кодом ушло кассиру. Код действует 10 минут.";
                  });
                else
                  go(async () => {
                    await apipayVerifyCashierFn({ data: { botId: c.id, otp } });
                    setSmsSent(false);
                    setOtp("");
                    return "Кассир привязан.";
                  });
              }}
            >
              <input
                className="input w-48"
                placeholder="+7 7XX XXX XX XX"
                aria-label="Номер кассира Kaspi Pay"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={smsSent}
              />
              {smsSent && (
                <input
                  className="input w-28"
                  placeholder="Код"
                  aria-label="Код из SMS"
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
              )}
              <button className="btn-secondary" disabled={act.busy}>
                {smsSent ? "Подтвердить код" : "Прислать SMS кассиру"}
              </button>
              {smsSent && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={act.busy}
                  onClick={() => setSmsSent(false)}
                >
                  Другой номер
                </button>
              )}
            </form>
          )}

          {!kycOk && (
            <div className="space-y-1">
              <button
                className="btn-secondary"
                disabled={act.busy}
                onClick={() =>
                  go(async () => {
                    const r = await apipayKycLinkFn({ data: { botId: c.id } });
                    setKycUrl(r.url);
                  })
                }
              >
                Ссылка на анкету для продавца
              </button>
              {kycUrl && (
                <p className="break-all">
                  Отправьте продавцу (показывается один раз, новая отменяет прежнюю):{" "}
                  <a className="link" href={kycUrl} target="_blank" rel="noreferrer">
                    {kycUrl}
                  </a>
                </p>
              )}
            </div>
          )}

          {(!tariffOk || st.tariff?.is_trial) && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                go(async () => {
                  await apipayPayTariffFn({
                    data: { botId: c.id, tierId: tier, months, phone: payer },
                  });
                  return "Счёт за тариф ушёл продавцу в Kaspi.";
                });
              }}
            >
              {plans.length > 0 ? (
                <select
                  className="input w-56"
                  aria-label="Тариф ApiPay"
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                >
                  <option value="">Тариф…</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={act.busy}
                  onClick={() =>
                    go(async () => {
                      const list = await apipayPlansFn();
                      setPlans(list);
                      if (!list.length) return "ApiPay не вернул тарифов.";
                    })
                  }
                >
                  Показать тарифы ApiPay
                </button>
              )}
              <input
                className="input w-20"
                type="number"
                min={1}
                max={12}
                aria-label="Месяцев"
                value={months}
                onChange={(e) => setMonths(Number(e.target.value) || 1)}
              />
              <input
                className="input w-48"
                placeholder="Kaspi плательщика"
                aria-label="Номер Kaspi плательщика"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
              />
              <button className="btn-secondary" disabled={act.busy || !tier}>
                Выставить счёт за тариф
              </button>
            </form>
          )}

          <button
            className={st.keyIssued ? "btn-secondary" : "btn-primary"}
            disabled={act.busy || !cashier}
            onClick={() => {
              if (
                st.keyIssued &&
                !window.confirm("Перевыпустить ключ? Прежний сразу перестанет работать.")
              )
                return;
              go(async () => {
                const r = await apipayIssueKeyFn({ data: { botId: c.id, reissue: st.keyIssued } });
                return r.test
                  ? "Ключ выпущен, у продавца включён тестовый режим (песочница ApiPay)."
                  : "Ключ выпущен, оплата Kaspi у продавца включена.";
              });
            }}
          >
            {st.keyIssued ? "Перевыпустить ключ" : "Выпустить ключ и включить оплату"}
          </button>
        </div>
      )}
      {note && <p className="mt-2 text-sm text-ok">{note}</p>}
      <ErrorBox error={act.error ?? load.error} />
    </Card>
  );
}

/** Партнёрский ключ ApiPay платформы: хранится зашифрованным, назад не показывается. */
export function ApipayPartnerKeyCard() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    void apipayPartnerKeyStateFn().then((r) => setConfigured(r.configured));
  }, []);
  const save = useAction(async (v: string) => {
    await setApipayPartnerKeyFn({ data: { value: v } });
    setConfigured(Boolean(v.trim()));
    setValue("");
  });
  return (
    <Card
      title="ApiPay (Kaspi)"
      actions={
        configured !== null && (
          <Badge tone={configured ? "ok" : undefined}>{configured ? "задан" : "не задан"}</Badge>
        )
      }
    >
      <p className="mb-2 text-sm text-muted">
        Партнёрский ключ ApiPay (X-Partner-Key): с ним карточка клиента подключает продавцу оплату
        Kaspi. Хранится зашифрованным, назад не показывается.
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(value).catch(() => {});
        }}
      >
        <input
          className="input w-72"
          type="password"
          autoComplete="off"
          aria-label="Партнёрский ключ ApiPay"
          placeholder={configured ? "Новый ключ" : "Ключ"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn-secondary" disabled={save.busy || !value.trim()}>
          Сохранить
        </button>
        {configured && (
          <button
            type="button"
            className="btn-secondary"
            disabled={save.busy}
            onClick={() => {
              if (window.confirm("Стереть партнёрский ключ ApiPay?"))
                void save.run("").catch(() => {});
            }}
          >
            Стереть
          </button>
        )}
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}
