import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  connectTelegramAdminFn,
  deletePaymentMethodFn,
  savePaymentMethodFn,
  saveSettingsFn,
  settingsFn,
  telegramStateFn,
} from "@/app/admin/admin.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";

export const Route = createFileRoute("/admin/_authed/settings")({
  loader: async () => {
    const [settings, telegram] = await Promise.all([settingsFn(), telegramStateFn()]);
    return { ...settings, telegram };
  },
  component: SettingsPage,
});

type Method = Awaited<ReturnType<typeof settingsFn>>["methods"][number];

function SettingsPage() {
  const { settings, methods, ownerTelegramId, telegram } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    await saveSettingsFn({
      data: {
        shop_name: String(f.get("shop_name")),
        admin_chat_id: String(f.get("admin_chat_id")),
        admin_contact_link: String(f.get("admin_contact_link")),
        instruction_caption: String(f.get("instruction_caption")),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  return (
    <>
      <PageTitle title="Оплата и настройки" />
      <div className="grid gap-4 lg:grid-cols-2">
        <TelegramCard telegram={telegram} />
        <Card title="Магазин">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save.run(new FormData(e.currentTarget)).catch(() => {});
            }}
          >
            <Field label="Название в боте">
              <input
                className="input"
                name="shop_name"
                defaultValue={settings.shop_name ?? shop.name}
              />
            </Field>
            <Field
              label="Telegram ID для уведомлений о заказах"
              hint={`Через запятую. Можно ID группы. Владелец${ownerTelegramId ? ` (${ownerTelegramId})` : ""} получает всегда. Свой ID узнаётся командой /id в боте.`}
            >
              <input
                className="input"
                name="admin_chat_id"
                defaultValue={settings.admin_chat_id ?? ""}
              />
            </Field>
            <Field label="Ссылка «Связаться с продавцом»">
              <input
                className="input"
                name="admin_contact_link"
                defaultValue={settings.admin_contact_link ?? ""}
                placeholder="https://t.me/username"
              />
            </Field>
            <Field label="Текст инструкции покупателю">
              <textarea
                className="input"
                name="instruction_caption"
                rows={3}
                defaultValue={settings.instruction_caption ?? ""}
              />
            </Field>
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={save.busy}>
                Сохранить
              </button>
              {saved && <span className="text-xs text-ok">Сохранено</span>}
            </div>
            <ErrorBox error={save.error} />
          </form>
        </Card>
        <PaymentMethods methods={methods} />
      </div>
    </>
  );
}

function PaymentMethods({ methods }: { methods: Method[] }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
  const [editing, setEditing] = useState<Method | "new" | null>(null);
  const save = useAction(async (f: FormData, id: string | null) => {
    await savePaymentMethodFn({
      data: {
        id,
        countryCode: String(f.get("countryCode")).toUpperCase(),
        countryName: String(f.get("countryName")),
        currency: String(f.get("currency")).toUpperCase(),
        instructions: String(f.get("instructions")),
        qrCodePath: String(f.get("qrCodePath")) || null,
        isActive: f.get("isActive") === "on",
        sortOrder: Number(f.get("sortOrder")) || 0,
      },
    });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm("Удалить способ оплаты?")) return;
    await deletePaymentMethodFn({ data: { id } });
    await router.invalidate();
  });
  const cur = editing === "new" ? null : editing;
  const [qr, setQr] = useState<string | null>(null);
  return (
    <Card
      title="Способы оплаты по странам"
      actions={
        <button
          className="btn-secondary text-xs"
          onClick={() => {
            setQr(null);
            setEditing("new");
          }}
        >
          + Страна
        </button>
      }
    >
      <p className="mb-3 text-xs text-muted">
        Покупатель выбирает страну, видит реквизиты и QR, присылает чек. Первая страна в списке —
        домашняя, по ней считается цена, пока страна покупателя неизвестна.
      </p>
      <ul className="divide-y divide-line">
        {methods.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div>
              <span className="font-medium">{m.country_name}</span>{" "}
              <span className="text-muted">
                {m.country_code} · {m.currency}
              </span>{" "}
              {!m.is_active && <Badge>выкл</Badge>}
              <div className="line-clamp-1 text-xs text-muted">{m.instructions}</div>
            </div>
            <div className="shrink-0">
              <button
                className="btn-ghost text-xs"
                onClick={() => {
                  setQr(m.qr_code_path);
                  setEditing(m);
                }}
              >
                Изменить
              </button>
              <button
                className="btn-ghost text-xs text-danger"
                onClick={() => void del.run(m.id).catch(() => {})}
              >
                Удалить
              </button>
            </div>
          </li>
        ))}
        {methods.length === 0 && (
          <li className="py-3 text-sm text-muted">
            Пока ни одной страны — покупатели не смогут оформить заказ.
          </li>
        )}
      </ul>
      <ErrorBox error={del.error} />
      {editing !== null && (
        <form
          key={cur?.id ?? "new"}
          className="mt-4 space-y-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(new FormData(e.currentTarget), cur?.id ?? null).catch(() => {});
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Код страны">
              <input
                className="input"
                name="countryCode"
                defaultValue={cur?.country_code ?? ""}
                placeholder="KZ"
                required
                maxLength={8}
              />
            </Field>
            <Field label="Название">
              <input
                className="input"
                name="countryName"
                defaultValue={cur?.country_name ?? ""}
                placeholder="Казахстан"
                required
              />
            </Field>
            <Field label="Валюта">
              <input
                className="input"
                name="currency"
                defaultValue={cur?.currency ?? "KZT"}
                maxLength={3}
                required
              />
            </Field>
          </div>
          <Field
            label="Реквизиты и инструкция"
            hint="Этот текст покупатель увидит после оформления."
          >
            <textarea
              className="input"
              name="instructions"
              rows={4}
              defaultValue={cur?.instructions ?? ""}
              required
            />
          </Field>
          <Field label="QR-код (картинка)">
            <input type="hidden" name="qrCodePath" value={qr ?? ""} />
            <div className="flex items-center gap-3">
              {qr && (
                <img
                  src={imagePath(shop.botId, qr)}
                  alt="QR"
                  className="h-16 w-16 rounded border border-line object-cover"
                />
              )}
              <label className="btn-secondary cursor-pointer text-xs">
                {qr ? "Заменить" : "Загрузить"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const fd = new FormData();
                    fd.set("kind", "image");
                    fd.set("file", file);
                    const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
                    const j = (await r.json()) as { key?: string };
                    if (j.key) setQr(j.key);
                  }}
                />
              </label>
              {qr && (
                <button type="button" className="btn-ghost text-xs" onClick={() => setQr(null)}>
                  Убрать
                </button>
              )}
            </div>
          </Field>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={cur?.is_active ?? true} />{" "}
              Активен
            </label>
            <label className="flex items-center gap-2 text-sm">
              Порядок{" "}
              <input
                className="input w-20"
                name="sortOrder"
                type="number"
                defaultValue={cur?.sort_order ?? methods.length}
              />
            </label>
          </div>
          <ErrorBox error={save.error} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={save.busy}>
              Сохранить
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              Отмена
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

type TelegramState = Awaited<ReturnType<typeof telegramStateFn>>;

function TelegramCard({ telegram }: { telegram: TelegramState }) {
  const router = useRouter();
  const [result, setResult] = useState<string | null>(null);
  const connect = useAction(async (token: string) => {
    const r = await connectTelegramAdminFn({ data: { token } });
    setResult(
      r.webhook?.ok
        ? `Бот @${r.username} подключён, вебхук установлен.`
        : `Токен принят, но вебхук не установлен: ${r.webhook?.error ?? "неизвестно"}`,
    );
    await router.invalidate();
  });
  const ok = telegram.connected && telegram.servedBy === "v2" && telegram.webhook?.ok;
  return (
    <Card
      title="Telegram-бот"
      actions={
        telegram.connected ? (
          <Badge tone={ok ? "ok" : "warn"}>
            {ok
              ? `@${telegram.username} работает`
              : `@${telegram.username ?? "бот"} · проверьте вебхук`}
          </Badge>
        ) : (
          <Badge>не подключён</Badge>
        )
      }
      className="lg:col-span-2"
    >
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>
          В Telegram откройте{" "}
          <a
            className="text-accent hover:underline"
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
          >
            @BotFather
          </a>
          , команда <code>/newbot</code>, придумайте имя.
        </li>
        <li>
          Скопируйте токен вида <code>123456789:AA…</code> и вставьте ниже. Всё остальное платформа
          сделает сама.
        </li>
      </ol>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void connect
            .run(String(new FormData(form).get("token")).trim())
            .then(() => form.reset())
            .catch(() => {});
        }}
      >
        <input
          className="input"
          name="token"
          placeholder={telegram.connected ? "Новый токен, если сменили бота" : "Токен из BotFather"}
          autoComplete="off"
          required
        />
        <button className="btn-primary shrink-0" disabled={connect.busy}>
          {telegram.connected ? "Заменить" : "Подключить"}
        </button>
      </form>
      {result && <p className="mt-2 text-sm text-muted">{result}</p>}
      <ErrorBox error={connect.error} />
      {telegram.connected && telegram.webhook && !telegram.webhook.ok && (
        <p className="mt-2 text-xs text-warn">
          Вебхук сейчас: {telegram.webhook.url ?? "не установлен"}.{" "}
          {telegram.servedBy !== "v2"
            ? "Магазин обслуживается старой платформой — вставьте токен ещё раз, чтобы перевести сюда."
            : "Вставьте токен ещё раз, чтобы переустановить."}
        </p>
      )}
    </Card>
  );
}
