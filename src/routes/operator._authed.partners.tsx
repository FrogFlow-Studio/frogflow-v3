import { WorkspaceTool } from "@/app/operator/workspace";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  deletePartnerFn,
  partnersFn,
  savePartnerFn,
  setClientPartnerFn,
} from "@/app/operator/partners.functions";
import { Card, Empty, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/partners")({
  loader: () => partnersFn(),
  component: PartnersPage,
});

const money = (n: number, cur: string) => `${n.toLocaleString("ru")} ${cur}`;

/**
 * Партнёрская программа агентств (core/partners): партнёр приводит
 * продавцов по ссылке регистрации и получает процент с их оплат подписки.
 * Отчёт партнёр смотрит сам по подписанной ссылке.
 */
function PartnersPage() {
  const { partners, clients, signupUrl } = Route.useLoaderData();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const save = useAction(async (f: FormData) => {
    await savePartnerFn({
      data: {
        code: String(f.get("code")).trim().toLowerCase(),
        name: String(f.get("name")).trim(),
        contact: String(f.get("contact") ?? "").trim(),
        percent: Number(f.get("percent")),
      },
    });
    setMsg("Партнёр сохранён");
    await router.invalidate();
  });
  const remove = useAction(async (code: string) => {
    if (!window.confirm(`Удалить партнёра ${code}?`)) return;
    await deletePartnerFn({ data: { code } });
    await router.invalidate();
  });
  const assign = useAction(async (botId: string, code: string | null) => {
    await setClientPartnerFn({ data: { botId, code } });
    await router.invalidate();
  });
  return (
    <>
      <PageTitle
        title="Партнёры"
        subtitle="Агентства, которые приводят продавцов: процент с оплат подписки их клиентов за последние 12 месяцев."
      />
      {msg && <p className="mb-3 text-sm text-ok">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {partners.length === 0 && <Empty>Партнёров пока нет.</Empty>}
        {partners.map((p) => (
          <Card key={p.partner.code} title={`${p.partner.name} · ${p.partner.percent}%`}>
            <div className="space-y-2 text-sm">
              <div className="text-muted">
                Код <code>{p.partner.code}</code>
                {p.partner.contact ? ` · ${p.partner.contact}` : ""}
              </div>
              <div>
                Ссылка регистрации:{" "}
                <code className="break-all text-xs">{`${signupUrl}${p.partner.code}`}</code>
              </div>
              <div>
                Отчёт для партнёра:{" "}
                <a className="break-all text-xs text-accent underline" href={p.link}>
                  {p.link}
                </a>
              </div>
              <div className="font-medium">
                {p.totals.length === 0
                  ? "Оплат пока нет"
                  : p.totals
                      .map(
                        (x) =>
                          `оплачено ${money(x.paid, x.currency)} · комиссия ${money(x.commission, x.currency)}`,
                      )
                      .join("; ")}
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Клиент</th>
                    <th>План</th>
                    <th className="text-right">Оплачено</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.clients.map((c) => (
                    <tr key={c.botId}>
                      <td>{c.name}</td>
                      <td>{c.plan}</td>
                      <td className="text-right tabular-nums">
                        {Object.entries(c.paid)
                          .map(([cur, n]) => money(n, cur))
                          .join(", ") || "—"}
                      </td>
                      <td className="text-right">
                        <button
                          className="text-xs text-muted underline"
                          onClick={() => void assign.run(c.botId, null).catch(() => {})}
                        >
                          снять
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <select
                className="input"
                value=""
                onChange={(e) =>
                  e.target.value && void assign.run(e.target.value, p.partner.code).catch(() => {})
                }
              >
                <option value="">+ привязать клиента…</option>
                {clients
                  .filter((c) => c.partner !== p.partner.code)
                  .map((c) => (
                    <option key={c.botId} value={c.botId}>
                      {c.name}
                      {c.partner ? ` (сейчас: ${c.partner})` : ""}
                    </option>
                  ))}
              </select>
              {p.clients.length === 0 && (
                <button
                  className="btn-danger"
                  onClick={() => void remove.run(p.partner.code).catch(() => {})}
                >
                  Удалить партнёра
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <WorkspaceTool title="Добавить или изменить партнёра">
        <Card title="Условия партнёрства">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setMsg(null);
              void save.run(new FormData(e.currentTarget)).catch(() => {});
            }}
          >
            <Field label="Код (латиница, 3–30)">
              <input className="input" name="code" required pattern="[a-z0-9][a-z0-9-]{2,29}" />
            </Field>
            <Field label="Название агентства">
              <input className="input" name="name" required maxLength={120} />
            </Field>
            <Field label="Контакт">
              <input className="input" name="contact" maxLength={200} />
            </Field>
            <Field label="Процент с оплат">
              <input
                className="input"
                name="percent"
                type="number"
                min={0}
                max={50}
                step="0.5"
                defaultValue={20}
                required
              />
            </Field>
            <div className="sm:col-span-2">
              <button className="btn-primary" disabled={save.busy}>
                Сохранить
              </button>
            </div>
            <ErrorBox error={save.error ?? remove.error ?? assign.error} />
          </form>
        </Card>
      </WorkspaceTool>
    </>
  );
}
