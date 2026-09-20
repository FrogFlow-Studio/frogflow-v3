import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  connectTelegramAdminFn,
  deleteDeliveryZoneFn,
  deletePaymentMethodFn,
  saveDeliveryZoneFn,
  deliveryZonesFn,
  savePaymentMethodFn,
  saveSettingsFn,
  settingsFn,
  telegramStateFn,
} from "@/app/admin/admin.functions";
import { Badge, Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";

export const Route = createFileRoute("/admin/_authed/settings")({
  loader: async () => {
    const [settings, telegram, zones] = await Promise.all([
      settingsFn(),
      telegramStateFn(),
      deliveryZonesFn(),
    ]);
    return { ...settings, telegram, zones };
  },
  component: SettingsPage,
});

type Method = Awaited<ReturnType<typeof settingsFn>>["methods"][number];

function SettingsPage() {
  const { settings, methods, ownerTelegramId, telegram, zones } = Route.useLoaderData();
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
        ...(shop.modules.loyalty
          ? { loyalty_earn_percent: String(f.get("loyalty_earn_percent") || "5") }
          : {}),
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
            {shop.modules.loyalty && (
              <Field
                label="Баллы за покупку, % от суммы заказа"
                hint="Начисляются после выдачи; 1 балл = 1 единица валюты при оплате следующего заказа."
              >
                <input
                  className="input w-32"
                  name="loyalty_earn_percent"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={settings.loyalty_earn_percent ?? "5"}
                />
              </Field>
            )}
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
        <FulfillmentCard settings={settings} />
        <ZonesCard zones={zones} />
        {shop.modules.robokassa && <RobokassaCard settings={settings} />}
        <LegalCard settings={settings} />
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

function FulfillmentCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    await saveSettingsFn({
      data: {
        fulfillment_pickup_enabled: f.get("pickup") === "on" ? "true" : "false",
        fulfillment_delivery_enabled: f.get("delivery") === "on" ? "true" : "false",
        payment_mode: String(f.get("payment_mode")),
        deposit_percent: String(f.get("deposit_percent") || "30"),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const [mode, setMode] = useState(settings.payment_mode ?? "full");
  return (
    <Card title="Физические товары: получение и оплата">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="pickup"
              defaultChecked={settings.fulfillment_pickup_enabled !== "false"}
            />{" "}
            Самовывоз
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="delivery"
              defaultChecked={settings.fulfillment_delivery_enabled !== "false"}
            />{" "}
            Доставка
          </label>
        </div>
        <Field label="Оплата физических заказов">
          <select
            className="input"
            name="payment_mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="full">Полная предоплата по чеку</option>
            <option value="deposit">Задаток по чеку, остаток при получении</option>
            <option value="on_receipt">Оплата при получении, без чека</option>
          </select>
        </Field>
        {mode === "deposit" && (
          <Field label="Задаток, % от суммы">
            <input
              className="input w-32"
              name="deposit_percent"
              type="number"
              min={1}
              max={100}
              defaultValue={settings.deposit_percent ?? "30"}
            />
          </Field>
        )}
        <div className="flex items-center gap-3">
          <button className="btn-secondary" disabled={save.busy}>
            Сохранить
          </button>
          {saved && <span className="text-xs text-ok">Сохранено</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

type Zone = Awaited<ReturnType<typeof deliveryZonesFn>>[number];

function ZonesCard({ zones }: { zones: Zone[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Zone | "new" | null>(null);
  const save = useAction(async (f: FormData, id: string | null) => {
    await saveDeliveryZoneFn({
      data: {
        id,
        name: String(f.get("name")),
        price: Number(f.get("price")) || 0,
        isActive: f.get("isActive") === "on",
        sortOrder: Number(f.get("sortOrder")) || 0,
      },
    });
    setEditing(null);
    await router.invalidate();
  });
  const del = useAction(async (id: string) => {
    if (!confirm("Удалить зону?")) return;
    await deleteDeliveryZoneFn({ data: { id } });
    await router.invalidate();
  });
  const cur = editing === "new" ? null : editing;
  return (
    <Card
      title="Зоны доставки"
      actions={
        <button className="btn-secondary text-xs" onClick={() => setEditing("new")}>
          + Зона
        </button>
      }
    >
      <p className="mb-3 text-xs text-muted">
        Покупатель выбирает зону при доставке, её цена добавляется к заказу. Без зон бот просто
        спросит адрес.
      </p>
      {zones.length === 0 ? (
        <p className="text-sm text-muted">Зон пока нет.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {zones.map((z) => (
            <li key={z.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {z.name} <span className="text-muted">· {Number(z.price)}</span>{" "}
                {!z.is_active && <Badge>выкл</Badge>}
              </span>
              <span className="shrink-0">
                <button className="btn-ghost text-xs" onClick={() => setEditing(z)}>
                  Изменить
                </button>
                <button
                  className="btn-ghost text-xs text-danger"
                  onClick={() => void del.run(z.id).catch(() => {})}
                >
                  Удалить
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={del.error} />
      {editing !== null && (
        <form
          key={cur?.id ?? "new"}
          className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_120px_80px_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void save.run(new FormData(e.currentTarget), cur?.id ?? null).catch(() => {});
          }}
        >
          <Field label="Название">
            <input
              className="input"
              name="name"
              defaultValue={cur?.name ?? ""}
              required
              maxLength={80}
              placeholder="Алмалинский район"
            />
          </Field>
          <Field label="Цена">
            <input
              className="input"
              name="price"
              type="number"
              min={0}
              step="1"
              defaultValue={cur ? Number(cur.price) : 0}
            />
          </Field>
          <Field label="Порядок">
            <input
              className="input"
              name="sortOrder"
              type="number"
              defaultValue={cur?.sort_order ?? zones.length}
            />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={cur?.is_active ?? true} />{" "}
            Активна
          </label>
          <div className="flex gap-2 sm:col-span-4">
            <button className="btn-primary" disabled={save.busy}>
              Сохранить
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              Отмена
            </button>
          </div>
          <ErrorBox error={save.error} />
        </form>
      )}
    </Card>
  );
}

function LegalCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    await saveSettingsFn({
      data: {
        legal_offer: String(f.get("legal_offer")),
        legal_privacy: String(f.get("legal_privacy")),
        legal_requisites: String(f.get("legal_requisites")),
        legal_about: String(f.get("legal_about")),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const docs = [
    ["legal_offer", "Публичная оферта"],
    ["legal_privacy", "Политика конфиденциальности"],
    ["legal_requisites", "Реквизиты продавца"],
    ["legal_about", "О продавце"],
  ] as const;
  return (
    <Card title="Юридические страницы" className="lg:col-span-2">
      <p className="mb-3 text-xs text-muted">
        Показываются в боте (кнопка «Информация») и на витрине{" "}
        {shop.slug ? `/s/${shop.slug}/legal/…` : ""}. Пустой текст — страница скрыта.
      </p>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        {docs.map(([k, title]) => (
          <Field key={k} label={title}>
            <textarea className="input" name={k} rows={5} defaultValue={settings[k] ?? ""} />
          </Field>
        ))}
        <div className="flex items-center gap-3 md:col-span-2">
          <button className="btn-secondary" disabled={save.busy}>
            Сохранить
          </button>
          {saved && <span className="text-xs text-ok">Сохранено</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

function RobokassaCard({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const { shop } = Route.useRouteContext();
  const [saved, setSaved] = useState(false);
  const save = useAction(async (f: FormData) => {
    await saveSettingsFn({
      data: {
        robokassa_enabled: f.get("enabled") === "on" ? "true" : "false",
        robokassa_test_mode: f.get("test") === "on" ? "true" : "false",
        robokassa_login: String(f.get("login")).trim(),
        robokassa_pass1: String(f.get("pass1")).trim(),
        robokassa_pass2: String(f.get("pass2")).trim(),
        robokassa_pass1_test: String(f.get("pass1t")).trim(),
        robokassa_pass2_test: String(f.get("pass2t")).trim(),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const resultUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/robokassa/${shop.botId}/result`;
  return (
    <Card title="Robokassa: оплата картой" className="lg:col-span-2">
      <p className="mb-3 text-xs text-muted">
        В личном кабинете Robokassa укажите Result URL{" "}
        <code className="rounded bg-surface-2 px-1">{resultUrl}</code>, Success URL{" "}
        <code className="rounded bg-surface-2 px-1">{resultUrl.replace(/result$/, "success")}</code>
        , Fail URL{" "}
        <code className="rounded bg-surface-2 px-1">{resultUrl.replace(/result$/, "fail")}</code>,
        метод POST, алгоритм MD5.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <div className="flex gap-4 text-sm sm:col-span-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={settings.robokassa_enabled === "true"}
            />{" "}
            Включить оплату картой
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="test"
              defaultChecked={settings.robokassa_test_mode === "true"}
            />{" "}
            Тестовый режим
          </label>
        </div>
        <Field label="MerchantLogin">
          <input
            className="input"
            name="login"
            defaultValue={settings.robokassa_login ?? ""}
            autoComplete="off"
          />
        </Field>
        <div />
        <Field label="Пароль #1 (боевой)">
          <input
            className="input"
            name="pass1"
            type="password"
            defaultValue={settings.robokassa_pass1 ?? ""}
            autoComplete="off"
          />
        </Field>
        <Field label="Пароль #2 (боевой)">
          <input
            className="input"
            name="pass2"
            type="password"
            defaultValue={settings.robokassa_pass2 ?? ""}
            autoComplete="off"
          />
        </Field>
        <Field label="Тестовый пароль #1">
          <input
            className="input"
            name="pass1t"
            type="password"
            defaultValue={settings.robokassa_pass1_test ?? ""}
            autoComplete="off"
          />
        </Field>
        <Field label="Тестовый пароль #2">
          <input
            className="input"
            name="pass2t"
            type="password"
            defaultValue={settings.robokassa_pass2_test ?? ""}
            autoComplete="off"
          />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="btn-secondary" disabled={save.busy}>
            Сохранить
          </button>
          {saved && <span className="text-xs text-ok">Сохранено</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
