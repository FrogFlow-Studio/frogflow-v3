import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  audienceCountFn,
  broadcastsFn,
  cancelBroadcastFn,
  createBroadcastFn,
  saveSettingsFn,
} from "@/app/admin/admin.functions";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";
import {
  MAX_PHOTOS,
  MAX_PRODUCT_BUTTONS,
  progressPercent,
  type AudienceType,
} from "@/core/broadcasts/pure";

export const Route = createFileRoute("/admin/_authed/broadcasts")({
  loader: () => broadcastsFn(),
  component: BroadcastsPage,
});

type Data = Awaited<ReturnType<typeof broadcastsFn>>;
type Broadcast = Data["broadcasts"][number];

const AUDIENCES: Array<{ value: AudienceType; label: string; hint: string }> = [
  { value: "all", label: "Всем", hint: "Все, кто запускал бота в Telegram" },
  { value: "buyers", label: "Покупателям", hint: "Есть хотя бы один оплаченный заказ" },
  { value: "non_buyers", label: "Ещё не покупали", hint: "Запускали бота, но не платили" },
  { value: "country", label: "По стране", hint: "Выбрали эту страну оплаты в боте" },
  { value: "test", label: "Себе на пробу", hint: "Только администраторам из настроек" },
];

const STATUS: Record<
  string,
  { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }
> = {
  queued: { label: "в очереди", tone: "accent" },
  sending: { label: "идёт", tone: "accent" },
  completed: { label: "завершена", tone: "ok" },
  cancelled: { label: "отменена", tone: "neutral" },
  failed: { label: "не доставлена", tone: "danger" },
};

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.set("kind", "image");
  fd.set("file", file);
  const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const j = (await r.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!r.ok || !j.key) throw new Error(j.error ?? `Загрузка не удалась (${r.status})`);
  return j.key;
}

function BroadcastsPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const router = useRouter();
  const active = data.broadcasts.some((b) => b.status === "queued" || b.status === "sending");

  // Пока рассылка идёт — обновляем список раз в 5 секунд.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void router.invalidate(), 5000);
    return () => clearInterval(t);
  }, [active, router]);

  return (
    <>
      <PageTitle
        title="Рассылки"
        subtitle="Сообщение уходит по 25 человек в минуту — Telegram не примет быстрее. Заблокировавшие бота считаются отдельно."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Composer data={data} botId={shop.botId} disabled={active} />
        <div className="space-y-4">
          {shop.modules.cart_reminder && <CartReminderCard hours={data.cartReminderHours} />}
          <History broadcasts={data.broadcasts} />
        </div>
      </div>
    </>
  );
}

function Composer({ data, botId, disabled }: { data: Data; botId: string; disabled: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [audience, setAudience] = useState<AudienceType>("all");
  const [country, setCountry] = useState(Object.keys(data.countries)[0] ?? "");
  const [count, setCount] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setCount(null);
    void audienceCountFn({
      data: { audience, countryCode: audience === "country" ? country : undefined },
    })
      .then((r) => {
        if (!cancelled) setCount(r.count);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [audience, country]);

  const send = useAction(async () => {
    const isTest = audience === "test";
    if (
      !isTest &&
      !confirm(`Отправить ${count ?? "?"} получателям? Отменить можно будет во время отправки.`)
    )
      return;
    await createBroadcastFn({
      data: {
        text,
        photoKeys: photos,
        productIds: products,
        showCatalog,
        audience,
        countryCode: audience === "country" ? country : undefined,
      },
    });
    if (!isTest) {
      setText("");
      setPhotos([]);
      setProducts([]);
      setShowCatalog(false);
    }
    await router.invalidate();
  });

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      const keys: string[] = [];
      for (const f of Array.from(files).slice(0, MAX_PHOTOS - photos.length))
        keys.push(await uploadImage(f));
      setPhotos((p) => [...p, ...keys].slice(0, MAX_PHOTOS));
    } catch (e) {
      setUploadError(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggleProduct = (id: string) =>
    setProducts((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_PRODUCT_BUTTONS ? [...p, id] : p,
    );

  const canSend =
    !disabled && !uploading && !send.busy && (text.trim() || photos.length > 0) && (count ?? 0) > 0;

  return (
    <Card title="Новая рассылка">
      {disabled && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          Сейчас идёт другая рассылка — новую можно создать после её завершения.
        </div>
      )}
      <div className="space-y-4">
        <Field
          label="Текст сообщения"
          hint={`${text.length} / 4000. Можно HTML: <b>жирный</b>, <i>курсив</i>, <a href="…">ссылка</a>.`}
        >
          <textarea
            className="input min-h-32"
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            placeholder="🎉 Новинка недели: …"
          />
        </Field>

        <div>
          <span className="label">Фото (до {MAX_PHOTOS})</span>
          <div className="flex flex-wrap gap-2">
            {photos.map((k) => (
              <div key={k} className="relative">
                <img
                  src={imagePath(botId, k)}
                  alt=""
                  className="h-20 w-20 rounded-md object-cover"
                />
                <button
                  type="button"
                  className="absolute -top-2 -right-2 grid h-6 w-6 place-items-center rounded-full bg-danger text-xs text-white"
                  onClick={() => setPhotos((p) => p.filter((x) => x !== k))}
                  aria-label="Убрать фото"
                >
                  ×
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label className="btn-secondary cursor-pointer text-xs">
                {uploading ? "Загрузка…" : "+ Добавить фото"}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void onFiles(e.target.files)}
                />
              </label>
            )}
          </div>
          <ErrorBox error={uploadError} />
        </div>

        <div>
          <span className="label">Кнопки под сообщением</span>
          <div className="flex items-center gap-3 py-1">
            <Switch
              checked={showCatalog}
              onChange={setShowCatalog}
              label="Кнопка «Открыть каталог»"
            />
            <span className="text-sm">Кнопка «📚 Открыть каталог»</span>
          </div>
          {data.products.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-muted">
                Товары кнопками: {products.length} / {MAX_PRODUCT_BUTTONS}
              </summary>
              <div className="mt-2 max-h-56 space-y-1 overflow-auto rounded-md border border-line p-2">
                {data.products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={products.includes(p.id)}
                      onChange={() => toggleProduct(p.id)}
                    />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>

        <div>
          <span className="label">Кому</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {AUDIENCES.map((a) => (
              <label
                key={a.value}
                className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${audience === a.value ? "border-accent bg-accent/10" : "border-line"}`}
              >
                <input
                  type="radio"
                  name="audience"
                  className="mt-1"
                  checked={audience === a.value}
                  onChange={() => setAudience(a.value)}
                />
                <span>
                  <span className="font-medium">{a.label}</span>
                  <span className="block text-xs text-muted">{a.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {audience === "country" && (
            <select
              className="input mt-2"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              {Object.keys(data.countries).length === 0 && (
                <option value="">Страны ещё не выбирал никто</option>
              )}
              {Object.entries(data.countries)
                .sort((a, b) => b[1] - a[1])
                .map(([code, n]) => (
                  <option key={code} value={code}>
                    {code} — {n}
                  </option>
                ))}
            </select>
          )}
          {audience === "test" && !data.hasAdminChat && (
            <p className="mt-2 text-xs text-danger">
              Не указан Telegram-id администратора — задайте его в настройках, иначе пробную
              рассылку отправить некому.
            </p>
          )}
          <p className="mt-2 text-sm text-muted">
            Получателей: <span className="font-medium text-fg tabular-nums">{count ?? "…"}</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="btn-primary"
            disabled={!canSend}
            onClick={() => void send.run().catch(() => {})}
          >
            {send.busy
              ? "Отправляем…"
              : audience === "test"
                ? "Отправить себе"
                : "Запустить рассылку"}
          </button>
        </div>
        <ErrorBox error={send.error} />
      </div>
    </Card>
  );
}

function History({ broadcasts }: { broadcasts: Broadcast[] }) {
  const router = useRouter();
  const cancel = useAction(async (id: string) => {
    if (!confirm("Остановить рассылку? Уже отправленные сообщения останутся.")) return;
    await cancelBroadcastFn({ data: { id } });
    await router.invalidate();
  });
  return (
    <Card title="История">
      {broadcasts.length === 0 ? (
        <Empty>Рассылок ещё не было.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {broadcasts.map((b) => {
            const st = STATUS[b.status] ?? { label: b.status, tone: "neutral" as const };
            const live = b.status === "queued" || b.status === "sending";
            const pct = progressPercent(b);
            return (
              <li key={b.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span className="text-xs text-muted">
                        {new Date(b.created_at).toLocaleString("ru")} ·{" "}
                        {AUDIENCES.find((a) => a.value === b.audience_type)?.label ??
                          b.audience_type}
                        {b.audience_type === "country" &&
                          ` (${(b.audience_filter as { country_code?: string })?.country_code ?? ""})`}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm">{b.message_text || "(только фото)"}</p>
                  </div>
                  {live && (
                    <button
                      className="btn-ghost text-xs text-danger"
                      onClick={() => void cancel.run(b.id).catch(() => {})}
                    >
                      Остановить
                    </button>
                  )}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full ${b.status === "failed" ? "bg-danger" : "bg-accent"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 flex gap-3 text-xs text-muted tabular-nums">
                  <span>всего {b.total_count}</span>
                  <span className="text-ok">доставлено {b.sent_count}</span>
                  {b.blocked_count > 0 && <span>заблокировали {b.blocked_count}</span>}
                  {b.failed_count > 0 && (
                    <span className="text-danger">ошибки {b.failed_count}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorBox error={cancel.error} />
    </Card>
  );
}

function CartReminderCard({ hours }: { hours: string }) {
  const router = useRouter();
  const [value, setValue] = useState(hours);
  const save = useAction(async () => {
    await saveSettingsFn({ data: { cart_reminder_hours: value.trim() } });
    await router.invalidate();
  });
  return (
    <Card title="Напоминание о брошенной корзине">
      <p className="mb-3 text-sm text-muted">
        Покупателю, который положил товары в корзину и не оформил заказ, бот напомнит об этом один
        раз. Новый товар в корзине разрешает следующее напоминание. «0» — выключить.
      </p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <Field label="Через сколько часов">
          <input
            className="input w-32"
            type="number"
            min={0}
            max={720}
            step={1}
            value={value}
            placeholder="6"
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <button className="btn-secondary" disabled={save.busy}>
          Сохранить
        </button>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}
