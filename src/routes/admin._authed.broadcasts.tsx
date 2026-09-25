import { createFileRoute, useRouteContext, useRouter } from "@tanstack/react-router";
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
import { adminT, intlLocale, type AdminKey, type AdminT } from "@/app/i18n/admin";
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

const AUDIENCES: Array<{ value: AudienceType; label: AdminKey; hint: AdminKey; tgOnly?: boolean }> =
  [
    { value: "all", label: "broadcasts.audience.all", hint: "broadcasts.audience.allHint" },
    {
      value: "buyers",
      label: "broadcasts.audience.buyers",
      hint: "broadcasts.audience.buyersHint",
    },
    {
      value: "non_buyers",
      label: "broadcasts.audience.nonBuyers",
      hint: "broadcasts.audience.nonBuyersHint",
    },
    {
      value: "country",
      label: "broadcasts.audience.country",
      hint: "broadcasts.audience.countryHint",
    },
    {
      value: "test",
      label: "broadcasts.audience.test",
      hint: "broadcasts.audience.testHint",
      tgOnly: true,
    },
  ];

const STATUS: Record<
  string,
  { label: AdminKey; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }
> = {
  queued: { label: "broadcasts.status.queued", tone: "accent" },
  sending: { label: "broadcasts.status.sending", tone: "accent" },
  completed: { label: "broadcasts.status.completed", tone: "ok" },
  cancelled: { label: "broadcasts.status.cancelled", tone: "neutral" },
  failed: { label: "broadcasts.status.failed", tone: "danger" },
};

const TEMPLATE_STATUS: Record<
  string,
  { label: AdminKey; tone: "ok" | "warn" | "danger" | "neutral" }
> = {
  APPROVED: { label: "broadcasts.templateStatus.approved", tone: "ok" },
  PENDING: { label: "broadcasts.templateStatus.pending", tone: "warn" },
  IN_APPEAL: { label: "broadcasts.templateStatus.inAppeal", tone: "warn" },
  REJECTED: { label: "broadcasts.templateStatus.rejected", tone: "danger" },
  PAUSED: { label: "broadcasts.templateStatus.paused", tone: "danger" },
  DISABLED: { label: "broadcasts.templateStatus.disabled", tone: "danger" },
  PENDING_DELETION: { label: "broadcasts.templateStatus.pendingDeletion", tone: "neutral" },
};

/** Языки шаблона — самоназвания, одинаковы на любом языке панели. */
const LANGUAGES = [
  { code: "ru", label: "Русский" },
  { code: "kk", label: "Қазақша" },
  { code: "en", label: "English" },
  { code: "uz", label: "Oʻzbekcha" },
];

/** Словарь панели для вложенных компонентов страницы. */
function useT(): AdminT {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  return adminT(shop.locale);
}

async function uploadImage(file: File, t: AdminT): Promise<string> {
  const fd = new FormData();
  fd.set("kind", "image");
  fd.set("file", file);
  const r = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const j = (await r.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!r.ok || !j.key)
    throw new Error(j.error ?? t("broadcasts.uploadFailed", { status: r.status }));
  return j.key;
}

function BroadcastsPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
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
        title={t("broadcasts.title")}
        subtitle={
          channel === "telegram"
            ? t("broadcasts.subtitle.telegram")
            : t("broadcasts.subtitle.whatsapp")
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
          <Card title={t("broadcasts.title")}>
            <Empty>{t("broadcasts.moduleOff")}</Empty>
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
  const t = useT();
  return (
    <div>
      <span className="label">{t("broadcasts.audience.label")}</span>
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
              <span className="font-medium">{t(a.label)}</span>
              <span className="block text-xs text-muted">{t(a.hint)}</span>
            </span>
          </label>
        ))}
      </div>
      {audience === "country" && (
        <select className="input mt-2" value={country} onChange={(e) => setCountry(e.target.value)}>
          {Object.keys(data.countries).length === 0 && (
            <option value="">{t("broadcasts.audience.noCountries")}</option>
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
        <p className="mt-2 text-xs text-danger">{t("broadcasts.audience.noAdminChat")}</p>
      )}
      <p className="mt-2 text-sm text-muted">
        {t("broadcasts.audience.recipients")}{" "}
        <span className="font-medium text-fg tabular-nums">{count ?? "…"}</span>
      </p>
    </div>
  );
}

function Composer({ data, botId, disabled }: { data: Data; botId: string; disabled: boolean }) {
  const t = useT();
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
    if (!isTest && !confirm(t("broadcasts.compose.confirmTelegram", { n: count ?? "?" }))) return;
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
        keys.push(await uploadImage(f, t));
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
    <Card title={t("broadcasts.compose.telegramTitle")}>
      {disabled && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t("broadcasts.compose.anotherActive")}
        </div>
      )}
      {!data.telegram && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t("broadcasts.compose.botOff")}
        </div>
      )}
      <div className="space-y-4">
        <Field
          label={t("broadcasts.compose.text")}
          hint={t("broadcasts.compose.textHint", { n: text.length })}
        >
          <textarea
            className="input min-h-32"
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("broadcasts.compose.textPlaceholder")}
          />
        </Field>

        <div>
          <span className="label">{t("broadcasts.compose.photos", { n: MAX_PHOTOS })}</span>
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
                  aria-label={t("broadcasts.compose.removePhoto")}
                >
                  ×
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label className="btn-secondary cursor-pointer text-xs">
                {uploading ? t("broadcasts.compose.uploading") : t("broadcasts.compose.addPhoto")}
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
          <span className="label">{t("broadcasts.compose.buttons")}</span>
          <div className="flex items-center gap-3 py-1">
            <Switch
              checked={showCatalog}
              onChange={setShowCatalog}
              label={t("broadcasts.compose.catalogSwitch")}
            />
            <span className="text-sm">{t("broadcasts.compose.catalogButton")}</span>
          </div>
          {data.products.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-muted">
                {t("broadcasts.compose.productButtons", {
                  n: products.length,
                  max: MAX_PRODUCT_BUTTONS,
                })}
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
              ? t("broadcasts.compose.sending")
              : audience === "test"
                ? t("broadcasts.compose.sendSelf")
                : t("broadcasts.compose.start")}
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
  const t = useT();
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
    if (!confirm(t("broadcasts.compose.confirmWhatsapp", { n: count ?? "?" }))) return;
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
    <Card title={t("broadcasts.compose.whatsappTitle")}>
      {disabled && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
          {t("broadcasts.compose.anotherActive")}
        </div>
      )}
      {wa.accounts.length === 0 ? (
        <Empty>{t("broadcasts.compose.whatsappOff")}</Empty>
      ) : (
        <div className="space-y-4">
          {wa.accounts.length > 1 && (
            <Field label={t("broadcasts.compose.fromNumber")}>
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
            label={t("broadcasts.compose.template")}
            hint={forAccount.length === 0 ? t("broadcasts.compose.noApproved") : undefined}
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
                <Field key={i} label={t("broadcasts.compose.param", { n: i + 1 })}>
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
              {fillTemplate(template.body, params) || t("broadcasts.compose.emptyTemplate")}
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
              {send.busy ? t("broadcasts.compose.sending") : t("broadcasts.compose.start")}
            </button>
          </div>
          <ErrorBox error={send.error} />
        </div>
      )}
    </Card>
  );
}

function TemplatesCard({ wa }: { wa: WhatsApp }) {
  const t = useT();
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
      title={t("broadcasts.templates.title")}
      actions={
        wa.accounts.length > 0 ? (
          <div className="flex gap-2">
            <button
              className="btn-secondary text-xs"
              disabled={sync.busy}
              onClick={() => void sync.run().catch(() => {})}
            >
              {sync.busy ? t("broadcasts.templates.syncing") : t("broadcasts.templates.sync")}
            </button>
            <button className="btn-secondary text-xs" onClick={() => setOpen((v) => !v)}>
              {open ? t("common.hide") : t("broadcasts.templates.new")}
            </button>
          </div>
        ) : undefined
      }
    >
      <p className="mb-3 text-sm text-muted">
        {t("broadcasts.templates.introBefore")} <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>
        {t("broadcasts.templates.introAfter")}
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
            <Field label={t("broadcasts.templates.account")}>
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
            <Field label={t("broadcasts.templates.name")} hint={t("broadcasts.templates.nameHint")}>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="new_arrivals"
                required
              />
            </Field>
            <Field label={t("broadcasts.templates.language")}>
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
            <Field
              label={t("broadcasts.templates.category")}
              hint={t("broadcasts.templates.categoryHint")}
            >
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
          <Field label={t("broadcasts.templates.body")} hint={`${body.length} / 1024`}>
            <textarea
              className="input min-h-24"
              value={body}
              maxLength={1024}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("broadcasts.templates.bodyPlaceholder")}
              required
            />
          </Field>
          <button className="btn-primary" disabled={create.busy}>
            {create.busy ? t("broadcasts.templates.submitting") : t("broadcasts.templates.submit")}
          </button>
          <ErrorBox error={create.error} />
        </form>
      )}
      {wa.templates.length === 0 ? (
        <Empty>{t("broadcasts.templates.empty")}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {wa.templates.map((tpl) => (
            <TemplateRow key={tpl.id} t={t} tpl={tpl} />
          ))}
        </ul>
      )}
      <ErrorBox error={sync.error} />
    </Card>
  );
}

function TemplateRow({ t, tpl }: { t: AdminT; tpl: Template }) {
  const st = TEMPLATE_STATUS[tpl.status];
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{tpl.name}</span>
        <span className="text-xs text-muted">{tpl.language}</span>
        <Badge tone={st?.tone ?? "neutral"}>{st ? t(st.label) : tpl.status}</Badge>
        <span className="text-xs text-muted">{tpl.category}</span>
      </div>
      {tpl.body && (
        <p className="mt-1 line-clamp-2 text-sm text-muted whitespace-pre-wrap">{tpl.body}</p>
      )}
      {tpl.reason && <p className="mt-1 text-xs text-danger">Meta: {tpl.reason}</p>}
    </li>
  );
}

function ExcludedPhonesCard({ phones }: { phones: string }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(phones);
  const save = useAction(async () => {
    const r = await setExcludedPhonesFn({ data: { phones: value } });
    setValue(r.phones);
    await router.invalidate();
  });
  return (
    <Card title={t("broadcasts.excluded.title")}>
      <p className="mb-3 text-sm text-muted">{t("broadcasts.excluded.intro")}</p>
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
          {t("common.save")}
        </button>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}

function History({ broadcasts, showChannel }: { broadcasts: Broadcast[]; showChannel: boolean }) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const router = useRouter();
  const cancel = useAction(async (id: string) => {
    if (!confirm(t("broadcasts.history.confirmStop"))) return;
    await cancelBroadcastFn({ data: { id } });
    await router.invalidate();
  });
  return (
    <Card title={t("broadcasts.history.title")}>
      {broadcasts.length === 0 ? (
        <Empty>{t("broadcasts.history.empty")}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {broadcasts.map((b) => {
            const st = STATUS[b.status];
            const live = b.status === "queued" || b.status === "sending";
            const pct = progressPercent(b);
            const audienceKey = AUDIENCES.find((a) => a.value === b.audience_type)?.label;
            return (
              <li key={b.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={st?.tone ?? "neutral"}>{st ? t(st.label) : b.status}</Badge>
                      {showChannel && (
                        <Badge tone="neutral">
                          {b.channel === "whatsapp" ? "WhatsApp" : "Telegram"}
                        </Badge>
                      )}
                      <span className="text-xs text-muted">
                        {new Date(b.created_at).toLocaleString(intlLocale(shop.locale))} ·{" "}
                        {audienceKey ? t(audienceKey) : b.audience_type}
                        {b.audience_type === "country" &&
                          ` (${(b.audience_filter as { country_code?: string })?.country_code ?? ""})`}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm">
                      {b.channel === "whatsapp"
                        ? t("broadcasts.history.template", {
                            name: b.template_name ?? "",
                            language: b.template_language ?? "",
                          })
                        : b.message_text || t("broadcasts.history.photoOnly")}
                    </p>
                  </div>
                  {live && (
                    <button
                      className="btn-ghost text-xs text-danger"
                      onClick={() => void cancel.run(b.id).catch(() => {})}
                    >
                      {t("broadcasts.history.stop")}
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
                  <span>{t("broadcasts.history.total", { n: b.total_count })}</span>
                  <span className="text-ok">
                    {t("broadcasts.history.sent", { n: b.sent_count })}
                  </span>
                  {b.blocked_count > 0 && (
                    <span>
                      {b.channel === "whatsapp"
                        ? t("broadcasts.history.notInWhatsapp", { n: b.blocked_count })
                        : t("broadcasts.history.blocked", { n: b.blocked_count })}
                    </span>
                  )}
                  {b.failed_count > 0 && (
                    <span className="text-danger">
                      {t("broadcasts.history.errors", { n: b.failed_count })}
                    </span>
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
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(hours);
  const save = useAction(async () => {
    await saveSettingsFn({ data: { cart_reminder_hours: value.trim() } });
    await router.invalidate();
  });
  return (
    <Card title={t("broadcasts.cart.title")}>
      <p className="mb-3 text-sm text-muted">{t("broadcasts.cart.intro")}</p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <Field label={t("broadcasts.cart.hours")}>
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
          {t("common.save")}
        </button>
      </form>
      <ErrorBox error={save.error} />
    </Card>
  );
}
