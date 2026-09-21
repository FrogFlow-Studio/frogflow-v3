import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  audienceCountFn,
  broadcastsFn,
  cancelBroadcastFn,
  createBroadcastFn,
  createWhatsAppTemplateFn,
  saveSettingsFn,
  setExcludedPhonesFn,
  syncWhatsAppTemplatesFn,
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
type WhatsApp = NonNullable<Data["whatsapp"]>;
type Template = WhatsApp["templates"][number];
type Channel = "telegram" | "whatsapp";

const AUDIENCES: Array<{ value: AudienceType; label: string; hint: string; tgOnly?: boolean }> = [
  { value: "all", label: "Всем", hint: "Все, кто писал боту в этом канале" },
  { value: "buyers", label: "Покупателям", hint: "Есть хотя бы один оплаченный заказ" },
  { value: "non_buyers", label: "Ещё не покупали", hint: "Писали боту, но не платили" },
  { value: "country", label: "По стране", hint: "Выбрали эту страну оплаты в боте" },
  {
    value: "test",
    label: "Себе на пробу",
    hint: "Только администраторам из настроек",
    tgOnly: true,
  },
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

const TEMPLATE_STATUS: Record<
  string,
  { label: string; tone: "ok" | "warn" | "danger" | "neutral" }
> = {
  APPROVED: { label: "одобрен", tone: "ok" },
  PENDING: { label: "на проверке", tone: "warn" },
  IN_APPEAL: { label: "апелляция", tone: "warn" },
  REJECTED: { label: "отклонён", tone: "danger" },
  PAUSED: { label: "приостановлен", tone: "danger" },
  DISABLED: { label: "отключён", tone: "danger" },
  PENDING_DELETION: { label: "удаляется", tone: "neutral" },
};

const LANGUAGES = [
  { code: "ru", label: "Русский" },
  { code: "kk", label: "Қазақша" },
  { code: "en", label: "English" },
  { code: "uz", label: "Oʻzbekcha" },
];

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
  const [channel, setChannel] = useState<Channel>(data.telegramModule ? "telegram" : "whatsapp");
  const activeIn = (c: Channel) =>
    data.broadcasts.some(
      (b) => b.channel === c && (b.status === "queued" || b.status === "sending"),
    );
  const anyActive = activeIn("telegram") || activeIn("whatsapp");

  // Пока рассылка идёт — обновляем список раз в 5 секунд.
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => void router.invalidate(), 5000);
    return () => clearInterval(t);
  }, [anyActive, router]);

  const both = data.telegramModule && data.whatsapp;
  return (
    <>
      <PageTitle
        title="Рассылки"
        subtitle={
          channel === "telegram"
            ? "Сообщение уходит по 25 человек в минуту — Telegram не примет быстрее. Заблокировавшие бота считаются отдельно."
            : "WhatsApp пропускает первое сообщение вне суточного окна только одобренным шаблоном Meta; каждое доставленное сообщение Meta тарифицирует."
        }
      />
      {both && (
        <div className="mb-4 flex gap-2">
          {(["telegram", "whatsapp"] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={channel === c ? "btn-primary text-sm" : "btn-secondary text-sm"}
              onClick={() => setChannel(c)}
            >
              {c === "telegram" ? "Telegram" : "WhatsApp"}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {channel === "telegram" && data.telegramModule ? (
          <Composer data={data} botId={shop.botId} disabled={activeIn("telegram")} />
        ) : data.whatsapp ? (
          <div className="space-y-4">
            <WhatsAppComposer data={data} wa={data.whatsapp} disabled={activeIn("whatsapp")} />
            <TemplatesCard wa={data.whatsapp} />
            <ExcludedPhonesCard phones={data.whatsapp.excludedPhones} />
          </div>
        ) : (
          <Card title="Рассылки">
            <Empty>Модуль рассылок не подключён.</Empty>
          </Card>
        )}
        <div className="space-y-4">
          {shop.modules.cart_reminder && channel === "telegram" && (
            <CartReminderCard hours={data.cartReminderHours} />
          )}
          <History
            broadcasts={data.broadcasts.filter((b) => (both ? b.channel === channel : true))}
            showChannel={!both}
          />
        </div>
      </div>
    </>
  );
}

function useAudienceCount(channel: Channel, audience: AudienceType, country: string) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCount(null);
    void audienceCountFn({
      data: { channel, audience, countryCode: audience === "country" ? country : undefined },
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
  }, [channel, audience, country]);
  return count;
}

function AudiencePicker({
  channel,
  data,
  audience,
  setAudience,
  country,
  setCountry,
  count,
}: {
  channel: Channel;
  data: Data;
  audience: AudienceType;
  setAudience: (a: AudienceType) => void;
  country: string;
  setCountry: (c: string) => void;
  count: number | null;
}) {
  return (
    <div>
      <span className="label">Кому</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {AUDIENCES.filter((a) => channel === "telegram" || !a.tgOnly).map((a) => (
          <label
            key={a.value}
            className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${audience === a.value ? "border-accent bg-accent/10" : "border-line"}`}
          >
            <input
              type="radio"
              name={`audience-${channel}`}
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
        <select className="input mt-2" value={country} onChange={(e) => setCountry(e.target.value)}>
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
          Не указан Telegram-id администратора — задайте его в настройках, иначе пробную рассылку
          отправить некому.
        </p>
      )}
      <p className="mt-2 text-sm text-muted">
        Получателей: <span className="font-medium text-fg tabular-nums">{count ?? "…"}</span>
      </p>
    </div>
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const count = useAudienceCount("telegram", audience, country);

  const send = useAction(async () => {
    const isTest = audience === "test";
    if (
      !isTest &&
      !confirm(`Отправить ${count ?? "?"} получателям? Отменить можно будет во время отправки.`)
    )
      return;
    await createBroadcastFn({
      data: {
        channel: "telegram",
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
    <Card title="Новая рассылка в Telegram">
      {disabled && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          Сейчас идёт другая рассылка — новую можно создать после её завершения.
        </div>
      )}
      {!data.telegram && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          Telegram-бот не подключён — рассылка встанет в очередь и уйдёт после подключения.
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

        <AudiencePicker
          channel="telegram"
          data={data}
          audience={audience}
          setAudience={setAudience}
          country={country}
          setCountry={setCountry}
          count={count}
        />

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

/** Подстановка параметров в тело шаблона — предпросмотр того, что увидит покупатель. */
function fillTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (m, n: string) => params[Number(n) - 1] || m);
}

function WhatsAppComposer({ data, wa, disabled }: { data: Data; wa: WhatsApp; disabled: boolean }) {
  const router = useRouter();
  const approved = wa.templates.filter((t) => t.status === "APPROVED");
  const [accountId, setAccountId] = useState(wa.accounts[0]?.id ?? "");
  const forAccount = approved.filter((t) => t.accountId === accountId);
  const [templateId, setTemplateId] = useState(forAccount[0]?.id ?? "");
  const template = forAccount.find((t) => t.id === templateId) ?? forAccount[0] ?? null;
  const [params, setParams] = useState<string[]>([]);
  const [audience, setAudience] = useState<AudienceType>("all");
  const [country, setCountry] = useState(Object.keys(data.countries)[0] ?? "");
  const count = useAudienceCount("whatsapp", audience, country);

  const send = useAction(async () => {
    if (!template) return;
    if (
      !confirm(
        `Отправить ${count ?? "?"} получателям в WhatsApp? Каждое доставленное сообщение оплачивается по тарифу Meta.`,
      )
    )
      return;
    await createBroadcastFn({
      data: {
        channel: "whatsapp",
        audience,
        countryCode: audience === "country" ? country : undefined,
        whatsapp: {
          accountId,
          templateName: template.name,
          templateLanguage: template.language,
          templateParams: params.slice(0, template.paramCount),
        },
      },
    });
    setParams([]);
    await router.invalidate();
  });

  const need = template?.paramCount ?? 0;
  const paramsOk = Array.from({ length: need }, (_, i) => params[i]?.trim()).every(Boolean);
  const canSend = !disabled && !send.busy && Boolean(template) && paramsOk && (count ?? 0) > 0;

  return (
    <Card title="Новая рассылка в WhatsApp">
      {disabled && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          Сейчас идёт другая рассылка — новую можно создать после её завершения.
        </div>
      )}
      {wa.accounts.length === 0 ? (
        <Empty>
          WhatsApp не подключён — подключите аккаунт в «Оплата и настройки» → «Instagram и
          WhatsApp».
        </Empty>
      ) : (
        <div className="space-y-4">
          {wa.accounts.length > 1 && (
            <Field label="От какого номера">
              <select
                className="input"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  setTemplateId("");
                  setParams([]);
                }}
              >
                {wa.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field
            label="Шаблон"
            hint={
              forAccount.length === 0
                ? "Одобренных шаблонов пока нет — создайте шаблон ниже и дождитесь проверки Meta."
                : undefined
            }
          >
            <select
              className="input"
              value={template?.id ?? ""}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setParams([]);
              }}
              disabled={forAccount.length === 0}
            >
              {forAccount.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.language}
                </option>
              ))}
            </select>
          </Field>
          {template && need > 0 && (
            <div className="space-y-2">
              {Array.from({ length: need }, (_, i) => (
                <Field key={i} label={`Подстановка {{${i + 1}}}`}>
                  <input
                    className="input"
                    value={params[i] ?? ""}
                    maxLength={1024}
                    onChange={(e) =>
                      setParams((p) => {
                        const next = [...p];
                        next[i] = e.target.value;
                        return next;
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          )}
          {template && (
            <div className="rounded-md border border-line bg-bg-soft p-3 text-sm whitespace-pre-wrap">
              {fillTemplate(template.body, params) || "(пустой шаблон)"}
            </div>
          )}

          <AudiencePicker
            channel="whatsapp"
            data={data}
            audience={audience}
            setAudience={setAudience}
            country={country}
            setCountry={setCountry}
            count={count}
          />

          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={!canSend}
              onClick={() => void send.run().catch(() => {})}
            >
              {send.busy ? "Отправляем…" : "Запустить рассылку"}
            </button>
          </div>
          <ErrorBox error={send.error} />
        </div>
      )}
    </Card>
  );
}

function TemplatesCard({ wa }: { wa: WhatsApp }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(wa.accounts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("ru");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("MARKETING");
  const [body, setBody] = useState("");

  const sync = useAction(async () => {
    for (const a of wa.accounts) await syncWhatsAppTemplatesFn({ data: { accountId: a.id } });
    await router.invalidate();
  });
  const create = useAction(async () => {
    await createWhatsAppTemplateFn({ data: { accountId, name, language, category, body } });
    setName("");
    setBody("");
    setOpen(false);
    await router.invalidate();
  });

  return (
    <Card
      title="Шаблоны Meta"
      actions={
        wa.accounts.length > 0 ? (
          <div className="flex gap-2">
            <button
              className="btn-secondary text-xs"
              disabled={sync.busy}
              onClick={() => void sync.run().catch(() => {})}
            >
              {sync.busy ? "Обновляем…" : "Обновить из Meta"}
            </button>
            <button className="btn-secondary text-xs" onClick={() => setOpen((v) => !v)}>
              {open ? "Скрыть" : "+ Новый шаблон"}
            </button>
          </div>
        ) : undefined
      }
    >
      <p className="mb-3 text-sm text-muted">
        Шаблон проходит проверку Meta (обычно до суток). Подстановки пишутся как{" "}
        <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>… — значения задаются при запуске рассылки.
      </p>
      {open && (
        <form
          className="mb-4 space-y-3 rounded-md border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create.run().catch(() => {});
          }}
        >
          {wa.accounts.length > 1 && (
            <Field label="Аккаунт">
              <select
                className="input"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {wa.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Имя" hint="латиница, цифры, «_»">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="new_arrivals"
                required
              />
            </Field>
            <Field label="Язык">
              <select
                className="input"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Категория" hint="MARKETING — акции; UTILITY — служебные, дешевле">
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value as "UTILITY" | "MARKETING")}
              >
                <option value="MARKETING">MARKETING</option>
                <option value="UTILITY">UTILITY</option>
              </select>
            </Field>
          </div>
          <Field label="Текст" hint={`${body.length} / 1024`}>
            <textarea
              className="input min-h-24"
              value={body}
              maxLength={1024}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Здравствуйте, {{1}}! У нас новинки: {{2}}. Ответьте «стоп», чтобы отписаться."
              required
            />
          </Field>
          <button className="btn-primary" disabled={create.busy}>
            {create.busy ? "Отправляем в Meta…" : "Отправить на проверку"}
          </button>
          <ErrorBox error={create.error} />
        </form>
      )}
      {wa.templates.length === 0 ? (
        <Empty>Шаблонов ещё нет.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {wa.templates.map((t) => (
            <TemplateRow key={t.id} t={t} />
          ))}
        </ul>
      )}
      <ErrorBox error={sync.error} />
    </Card>
  );
}

function TemplateRow({ t }: { t: Template }) {
  const st = TEMPLATE_STATUS[t.status] ?? { label: t.status, tone: "neutral" as const };
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t.name}</span>
        <span className="text-xs text-muted">{t.language}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="text-xs text-muted">{t.category}</span>
      </div>
      {t.body && (
        <p className="mt-1 line-clamp-2 text-sm text-muted whitespace-pre-wrap">{t.body}</p>
      )}
      {t.reason && <p className="mt-1 text-xs text-danger">Meta: {t.reason}</p>}
    </li>
  );
}

function ExcludedPhonesCard({ phones }: { phones: string }) {
  const router = useRouter();
  const [value, setValue] = useState(phones);
  const save = useAction(async () => {
    const r = await setExcludedPhonesFn({ data: { phones: value } });
    setValue(r.phones);
    await router.invalidate();
  });
  return (
    <Card title="Не писать этим номерам">
      <p className="mb-3 text-sm text-muted">
        Номера через запятую или с новой строки, в международном формате. Им не уйдёт ни одна
        рассылка, что бы ни выбрали в аудитории.
      </p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <textarea
          className="input min-h-20"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="77001234567, 77007654321"
        />
        <button className="btn-secondary" disabled={save.busy}>
          Сохранить
        </button>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}

function History({ broadcasts, showChannel }: { broadcasts: Broadcast[]; showChannel: boolean }) {
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
                      {showChannel && (
                        <Badge tone="neutral">
                          {b.channel === "whatsapp" ? "WhatsApp" : "Telegram"}
                        </Badge>
                      )}
                      <span className="text-xs text-muted">
                        {new Date(b.created_at).toLocaleString("ru")} ·{" "}
                        {AUDIENCES.find((a) => a.value === b.audience_type)?.label ??
                          b.audience_type}
                        {b.audience_type === "country" &&
                          ` (${(b.audience_filter as { country_code?: string })?.country_code ?? ""})`}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm">
                      {b.channel === "whatsapp"
                        ? `Шаблон ${b.template_name ?? ""} · ${b.template_language ?? ""}`
                        : b.message_text || "(только фото)"}
                    </p>
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
                  {b.blocked_count > 0 && (
                    <span>
                      {b.channel === "whatsapp" ? "не в WhatsApp" : "заблокировали"}{" "}
                      {b.blocked_count}
                    </span>
                  )}
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
