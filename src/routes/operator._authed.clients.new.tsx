import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent } from "react";
import { createClientFn } from "@/app/operator/operator.functions";
import { VERTICAL_KEYS, VERTICALS } from "@/core/verticals/registry";
import { Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";

export const Route = createFileRoute("/operator/_authed/clients/new")({ component: NewClientPage });

function NewClientPage() {
  const navigate = useNavigate();
  const { run, busy, error } = useAction(async (form: FormData) => {
    const { id } = await createClientFn({
      data: {
        name: String(form.get("name")),
        ownerId: String(form.get("ownerId")).trim().toLowerCase(),
        vertical: String(form.get("vertical")),
        ownerName: String(form.get("ownerName") || "") || undefined,
        ownerContact: String(form.get("ownerContact") || "") || undefined,
      },
    });
    await navigate({ to: "/operator/clients/$botId", params: { botId: id } });
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void run(new FormData(e.currentTarget)).catch(() => {});
  };
  return (
    <>
      <PageTitle
        title="Подключить клиента"
        subtitle="Карточка создаётся сразу. Telegram, модули и логин админки — дальше в карточке."
      />
      <form onSubmit={submit} className="max-w-xl space-y-4">
        <Card>
          <div className="space-y-4">
            <Field label="Название магазина">
              <input
                className="input"
                name="name"
                required
                maxLength={120}
                placeholder="Например, Print KZ Art"
              />
            </Field>
            <Field
              label="Идентификатор"
              hint="Латиница, цифры, дефис. Станет адресом /s/<идентификатор>."
            >
              <input
                className="input"
                name="ownerId"
                required
                pattern="[a-z0-9\-]{2,40}"
                placeholder="printkzart"
              />
            </Field>
            <Field label="Ниша">
              <select className="input" name="vertical" defaultValue="digital">
                {VERTICAL_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {VERTICALS[k].title}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Владелец">
                <input className="input" name="ownerName" maxLength={120} />
              </Field>
              <Field label="Контакт владельца">
                <input
                  className="input"
                  name="ownerContact"
                  maxLength={200}
                  placeholder="телефон или @username"
                />
              </Field>
            </div>
          </div>
        </Card>
        <ErrorBox error={error} />
        <button className="btn-primary" disabled={busy}>
          Создать клиента
        </button>
      </form>
    </>
  );
}
