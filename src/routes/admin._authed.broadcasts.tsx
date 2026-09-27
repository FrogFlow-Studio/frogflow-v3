import { saveWinbackFn, winbackFn } from "@/app/admin/winback.functions";
import { funnelFn, saveFunnelFn } from "@/app/admin/funnel.functions";
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
import { uploadFile } from "@/app/admin/upload-client";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";
import {
  MAX_PHOTOS,
  MAX_PRODUCT_BUTTONS,
  progressPercent,
  type AudienceType,
} from "@/core/broadcasts/pure";
import { SEGMENT_KINDS } from "@/core/broadcasts/segments";

export const Route = createFileRoute("/admin/_authed/broadcasts")({
  loader: () => broadcastsFn(),
  component: BroadcastsPage,
});

type Data = Awaited<ReturnType<typeof broadcastsFn>>;
type Broadcast = Data["broadcasts"][number];
type WhatsApp = NonNullable<Data["whatsapp"]>;
type Template = WhatsApp["templates"][number];
type Channel = "telegram" | "whatsapp";
/** «Сегмент» — в форме отдельный вариант; на сервер уходит как «все» + segment. */
type UiAudience = AudienceType | "segment";
type SegmentKind = (typeof SEGMENT_KINDS)[number];
type SegmentDraft = {
  kind: SegmentKind;
  productId: string;
  categoryId: string;
  days: string;
  locale: string;
  tag: string;
};
const EMPTY_SEGMENT: SegmentDraft = {
  kind: "product",
  productId: "",
  categoryId: "",
  days: "30",
  locale: "ru",
  tag: "",
};

/** Черновик сегмента → то, что примет parseSegment; незаполненный — undefined. */
function segmentOf(d: SegmentDraft): Record<string, unknown> | undefined {
  switch (d.kind) {
    case "product":
      return d.productId ? { kind: "product", productId: d.productId } : undefined;
    case "category":
      return d.categoryId ? { kind: "category", categoryId: d.categoryId } : undefined;
    case "inactive":
      return Number(d.days) >= 1 ? { kind: "inactive", days: Number(d.days) } : undefined;
    case "language":
      return { kind: "language", locale: d.locale };
    case "cart":
      return { kind: "cart" };
    case "tag":
      return d.tag.trim() ? { kind: "tag", tag: d.tag.trim() } : undefined;
  }
}

const AUDIENCES: Array<{ value: UiAudience; label: AdminKey; hint: AdminKey; tgOnly?: boolean }> = [
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
    value: "segment",
    label: "broadcasts.audience.segment",
    hint: "broadcasts.audience.segmentHint",
    tgOnly: true,
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
  return uploadFile("image", file, t, (status) => t("broadcasts.uploadFailed", { status }));
}

function BroadcastsPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>(data.telegramModule ? "telegram" : "whatsapp");
  // Запланированная на будущее рассылка форму не блокирует и опрос не включает.
  const activeIn = (c: Channel) =>
    data.broadcasts.some((b) => {
      if (b.channel !== c || (b.status !== "queued" && b.status !== "sending")) return false;
      const at = (b.audience_filter as { send_at?: string } | null)?.send_at;
      return b.status === "sending" || !at || Date.parse(at) <= Date.now();
    });
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
          {shop.modules.winback && <WinbackCard />}
          {shop.modules.funnel && <FunnelCard />}
          <History
            broadcasts={data.broadcasts.filter((b) => (both ? b.channel === channel : true))}
            showChannel={!both}
          />
        </div>
      </div>
    </>
  );
}

function useAudienceCount(
  channel: Channel,
  audience: UiAudience,
  country: string,
  segment?: Record<string, unknown>,
) {
  const [count, setCount] = useState<number | null>(null);
  const segKey = JSON.stringify(segment ?? null);
  useEffect(() => {
    let cancelled = false;
    setCount(null);
    if (audience === "segment" && !segment) {
      setCount(0);
      return;
    }
    void audienceCountFn({
      data: {
        channel,
        audience: audience === "segment" ? "all" : audience,
        countryCode: audience === "country" ? country : undefined,
        segment: audience === "segment" ? segment : undefined,
      },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, audience, country, segKey]);
  return count;
}

/** Выбор сегмента: что купили, давность, язык, корзина, тег продавца. */
function SegmentPicker({
  data,
  value,
  onChange,
}: {
  data: Data;
  value: SegmentDraft;
  onChange: (v: SegmentDraft) => void;
}) {
  const t = useT();
  const set = (patch: Partial<SegmentDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <select
        className="input"
        aria-label={t("broadcasts.segment.kind")}
        value={value.kind}
        onChange={(e) => set({ kind: e.target.value as SegmentKind })}
      >
        {SEGMENT_KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`broadcasts.segment.${k}` as AdminKey)}
          </option>
        ))}
      </select>
      {value.kind === "product" && (
        <select
          className="input"
          value={value.productId}
          onChange={(e) => set({ productId: e.target.value })}
        >
          <option value="">{t("broadcasts.segment.pickProduct")}</option>
          {data.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {value.kind === "category" && (
        <select
          className="input"
          value={value.categoryId}
          onChange={(e) => set({ categoryId: e.target.value })}
        >
          <option value="">{t("broadcasts.segment.pickCategory")}</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {value.kind === "inactive" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="number"
            className="input w-24"
            min={1}
            max={3650}
            value={value.days}
            onChange={(e) => set({ days: e.target.value })}
          />
          {t("broadcasts.segment.days")}
        </label>
      )}
      {value.kind === "language" && (
        <select
          className="input"
          value={value.locale}
          onChange={(e) => set({ locale: e.target.value })}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      )}
      {value.kind === "tag" && (
        <input
          className="input"
          placeholder={t("broadcasts.segment.tagPlaceholder")}
          value={value.tag}
          maxLength={32}
          onChange={(e) => set({ tag: e.target.value })}
        />
      )}
    </div>
  );
}

function AudiencePicker({
  channel,
  data,
  audience,
  setAudience,
  country,
  setCountry,
  count,
  segment,
  setSegment,
}: {
  channel: Channel;
  data: Data;
  audience: UiAudience;
  setAudience: (a: UiAudience) => void;
  country: string;
  setCountry: (c: string) => void;
  count: number | null;
  segment?: SegmentDraft;
  setSegment?: (s: SegmentDraft) => void;
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
      {audience === "segment" && segment && setSegment && (
        <SegmentPicker data={data} value={segment} onChange={setSegment} />
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
  const [audience, setAudience] = useState<UiAudience>("all");
  const [country, setCountry] = useState(Object.keys(data.countries)[0] ?? "");
  const [segment, setSegment] = useState<SegmentDraft>(EMPTY_SEGMENT);
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const seg = audience === "segment" ? segmentOf(segment) : undefined;
  const count = useAudienceCount("telegram", audience, country, seg);
  const scheduled = later && audience !== "test" && sendAt;

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
        audience: audience === "segment" ? "all" : audience,
        countryCode: audience === "country" ? country : undefined,
        segment: seg,
        // datetime-local — время браузера продавца; на сервер уходит абсолютное.
        sendAt: scheduled ? new Date(sendAt).toISOString() : undefined,
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
    !disabled &&
    !uploading &&
    !send.busy &&
    (text.trim() || photos.length > 0) &&
    (count ?? 0) > 0 &&
    (!later || audience === "test" || Boolean(sendAt));

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
          segment={segment}
          setSegment={setSegment}
        />

        {audience !== "test" && (
          <div className="flex flex-wrap items-center gap-3">
            <Switch checked={later} onChange={setLater} label={t("broadcasts.schedule.later")} />
            <span className="text-sm">{t("broadcasts.schedule.later")}</span>
            {later && (
              <input
                type="datetime-local"
                className="input w-auto"
                value={sendAt}
                onChange={(e) => setSendAt(e.target.value)}
              />
            )}
          </div>
        )}

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
                : scheduled
                  ? t("broadcasts.schedule.button")
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
            setAudience={(a) => a !== "segment" && setAudience(a)}
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
  type Btn = { type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; value: string };
  const [buttons, setButtons] = useState<Btn[]>([]);
  const setBtn = (i: number, patch: Partial<Btn>) =>
    setButtons((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const sync = useAction(async () => {
    for (const a of wa.accounts) await syncWhatsAppTemplatesFn({ data: { accountId: a.id } });
    await router.invalidate();
  });
  const create = useAction(async () => {
    await createWhatsAppTemplateFn({
      data: {
        accountId,
        name,
        language,
        category,
        body,
        buttons: buttons
          .filter((b) => b.text.trim())
          .map((b) =>
            b.type === "URL"
              ? { type: "URL" as const, text: b.text, url: b.value }
              : b.type === "PHONE_NUMBER"
                ? { type: "PHONE_NUMBER" as const, text: b.text, phone: b.value }
                : { type: "QUICK_REPLY" as const, text: b.text },
          ),
      },
    });
    setName("");
    setBody("");
    setButtons([]);
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
          <Field
            label={t("broadcasts.templates.buttons")}
            hint={t("broadcasts.templates.buttonsHint")}
          >
            <div className="space-y-2">
              {buttons.map((b, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[auto_1fr_1fr_auto]">
                  <select
                    className="input"
                    value={b.type}
                    onChange={(e) => setBtn(i, { type: e.target.value as Btn["type"], value: "" })}
                  >
                    <option value="QUICK_REPLY">{t("broadcasts.templates.btnQuick")}</option>
                    <option value="URL">{t("broadcasts.templates.btnUrl")}</option>
                    <option value="PHONE_NUMBER">{t("broadcasts.templates.btnPhone")}</option>
                  </select>
                  <input
                    className="input"
                    maxLength={25}
                    placeholder={t("broadcasts.templates.btnText")}
                    value={b.text}
                    onChange={(e) => setBtn(i, { text: e.target.value })}
                  />
                  {b.type !== "QUICK_REPLY" ? (
                    <input
                      className="input"
                      placeholder={b.type === "URL" ? "https://…" : "+7…"}
                      value={b.value}
                      onChange={(e) => setBtn(i, { value: e.target.value })}
                    />
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    className="btn-ghost text-xs text-danger"
                    onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              {buttons.length < 3 && (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() =>
                    setButtons((bs) => [...bs, { type: "QUICK_REPLY", text: "", value: "" }])
                  }
                >
                  {t("broadcasts.templates.addButton")}
                </button>
              )}
            </div>
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
            const filter = (b.audience_filter ?? {}) as {
              country_code?: string;
              segment?: { kind?: string };
              send_at?: string;
            };
            const audienceKey = AUDIENCES.find(
              (a) => a.value === (filter.segment ? "segment" : b.audience_type),
            )?.label;
            const waiting =
              b.status === "queued" && filter.send_at && Date.parse(filter.send_at) > Date.now();
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
                        {b.audience_type === "country" && ` (${filter.country_code ?? ""})`}
                        {filter.segment?.kind &&
                          ` (${t(`broadcasts.segment.${filter.segment.kind}` as AdminKey)})`}
                      </span>
                      {waiting && (
                        <Badge tone="accent">
                          {t("broadcasts.schedule.at", {
                            at: new Date(filter.send_at!).toLocaleString(intlLocale(shop.locale)),
                          })}
                        </Badge>
                      )}
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
                  {b.channel !== "whatsapp" && b.clicks > 0 && (
                    <span className="text-accent">
                      {t("broadcasts.history.clicks", { n: b.clicks })}
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

/** Возвратные продажи: серия из двух сообщений тем, кто давно не заказывал. */
function WinbackCard() {
  const t = useT();
  const [c, setC] = useState<Awaited<ReturnType<typeof winbackFn>> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void winbackFn().then(setC);
  }, []);
  const save = useAction(async () => {
    if (!c) return;
    await saveWinbackFn({ data: c });
    setSaved(true);
  });
  if (!c) return null;
  return (
    <Card
      title={t("broadcasts.winback.title")}
      actions={
        <Switch
          checked={c.enabled}
          onChange={(on) => setC({ ...c, enabled: on })}
          label={t("broadcasts.winback.enabled")}
        />
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("broadcasts.winback.intro")}</p>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label={t("broadcasts.winback.days1")}>
            <input
              className="input"
              type="number"
              min={3}
              max={365}
              value={c.days1}
              onChange={(e) => setC({ ...c, days1: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("broadcasts.winback.text1")}>
            <textarea
              className="input min-h-16"
              value={c.text1}
              onChange={(e) => setC({ ...c, text1: e.target.value })}
            />
          </Field>
          <Field label={t("broadcasts.winback.days2")}>
            <input
              className="input"
              type="number"
              min={4}
              max={365}
              value={c.days2 ?? ""}
              onChange={(e) =>
                setC({ ...c, days2: e.target.value ? Number(e.target.value) : null })
              }
            />
          </Field>
          <Field label={t("broadcasts.winback.text2")}>
            <textarea
              className="input min-h-16"
              value={c.text2}
              onChange={(e) => setC({ ...c, text2: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t("broadcasts.winback.promo")} hint={t("broadcasts.winback.promoHint")}>
          <input
            className="input w-48 uppercase"
            value={c.promo}
            onChange={(e) => setC({ ...c, promo: e.target.value })}
          />
        </Field>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">✓</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

/** Автоворонка: до 10 сообщений новому покупателю по часам от первого контакта. */
function FunnelCard() {
  const t = useT();
  const [c, setC] = useState<Awaited<ReturnType<typeof funnelFn>> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void funnelFn().then(setC);
  }, []);
  const save = useAction(async () => {
    if (!c) return;
    await saveFunnelFn({ data: c });
    setSaved(true);
  });
  if (!c) return null;
  const setStep = (i: number, patch: Partial<(typeof c.steps)[number]>) =>
    setC({ ...c, steps: c.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <Card
      title={t("broadcasts.funnel.title")}
      actions={
        <Switch
          checked={c.enabled}
          onChange={(on) => setC({ ...c, enabled: on })}
          label={t("broadcasts.winback.enabled")}
        />
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run().catch(() => {});
        }}
      >
        <p className="text-sm text-muted">{t("broadcasts.funnel.intro")}</p>
        {c.steps.map((s, i) => (
          <div key={i} className="rounded-md border border-line p-2">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              {t("broadcasts.funnel.after")}
              <input
                className="input w-24"
                type="number"
                min={1}
                max={1080}
                value={s.afterHours}
                onChange={(e) => setStep(i, { afterHours: Number(e.target.value) })}
              />
              {t("broadcasts.funnel.hours")}
              <label className="ml-auto flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={s.catalogButton}
                  onChange={(e) => setStep(i, { catalogButton: e.target.checked })}
                />
                {t("broadcasts.funnel.catalogButton")}
              </label>
              <button
                type="button"
                className="btn-ghost text-xs text-danger"
                onClick={() => setC({ ...c, steps: c.steps.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </div>
            <textarea
              className="input min-h-16"
              value={s.text}
              onChange={(e) => setStep(i, { text: e.target.value })}
            />
          </div>
        ))}
        {c.steps.length < 10 && (
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() =>
              setC({
                ...c,
                steps: [
                  ...c.steps,
                  {
                    afterHours: (c.steps[c.steps.length - 1]?.afterHours ?? 0) + 24,
                    text: "",
                    catalogButton: false,
                  },
                ],
              })
            }
          >
            {t("broadcasts.funnel.addStep")}
          </button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={c.stopOnOrder}
            onChange={(e) => setC({ ...c, stopOnOrder: e.target.checked })}
          />
          {t("broadcasts.funnel.stopOnOrder")}
        </label>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.busy}>
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">✓</span>}
        </div>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}
