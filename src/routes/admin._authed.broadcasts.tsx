import { saveWinbackFn, winbackFn } from "@/app/admin/winback.functions";
import { EngageBlock } from "@/app/admin/engage-block";
import { SimilarCard } from "@/app/admin/similar-card";
import { AutoStatsBlock } from "@/app/admin/auto-stats";
import { AutoPreview } from "@/app/admin/auto-preview";
import { GiveawayButtonPick, GiveawaysCard } from "@/app/admin/giveaways-card";
import type { AutoStats } from "@/core/automsg/stats";
import { birthdayFn, funnelFn, saveBirthdayFn, saveFunnelFn } from "@/app/admin/funnel.functions";
import { createFileRoute, useRouteContext, useRouter } from "@tanstack/react-router";
import { courseFn } from "@/app/admin/courses.functions";
import { useEffect, useRef, useState } from "react";
import {
  audienceCountFn,
  broadcastsFn,
  cancelBroadcastFn,
  moreBroadcastsFn,
  createBroadcastFn,
  createWhatsAppTemplateFn,
  setExcludedPhonesFn,
  syncWhatsAppTemplatesFn,
} from "@/app/admin/broadcasts.functions";
import { saveSettingsFn } from "@/app/admin/settings.functions";
import { adminT, intlLocale, type AdminKey, type AdminT } from "@/app/i18n/admin";
import { uploadFile } from "@/app/admin/upload-client";
import { ProductPicker, ProductSearch, type PickerProduct } from "@/app/admin/product-picker";
import { Badge, Card, Empty, ErrorBox, Field, PageTitle, Switch, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";
import { formatMoney } from "@/core/money/money";
import {
  MAX_PHOTOS,
  MAX_PRODUCT_BUTTONS,
  progressPercent,
  type AudienceType,
} from "@/core/broadcasts/pure";
import { abCompareState, abVerdict, type AbMoneySide } from "@/core/broadcasts/ab";
import { parseSegmentParam } from "@/core/broadcasts/segment-link";
import { SEGMENT_KINDS } from "@/core/broadcasts/segments";

export const Route = createFileRoute("/admin/_authed/broadcasts")({
  // Готовый сегмент из аналитики (?segment=inactive&days=60): подставляется в форму, не отправляется.
  validateSearch: (s: Record<string, unknown>) => ({
    segment: s.segment === "inactive" ? ("inactive" as const) : undefined,
    days: Number.isInteger(Number(s.days)) && Number(s.days) > 0 ? Number(s.days) : undefined,
    // «Дослать не купившим» из истории: id рассылки, у которой берём не заказавших.
    followup:
      typeof s.followup === "string" && /^[0-9a-f-]{36}$/i.test(s.followup)
        ? s.followup
        : undefined,
  }),
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
  /** Название выбранного товара — только для формы, в сегмент не уходит. */
  productName: string;
  categoryId: string;
  days: string;
  locale: string;
  tag: string;
  who: "all" | "behind" | "homework" | "completed";
  cohortId: string;
};
/** Сегменты по покупкам и корзине: консультанту без продаж их не из чего собрать. */
const SALES_SEGMENTS: readonly SegmentKind[] = ["product", "category", "inactive", "cart"];

const EMPTY_SEGMENT: SegmentDraft = {
  kind: "product",
  productId: "",
  productName: "",
  categoryId: "",
  days: "30",
  locale: "ru",
  tag: "",
  who: "all",
  cohortId: "",
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
    case "course":
      return d.productId
        ? { kind: "course", productId: d.productId, who: d.who, cohortId: d.cohortId || null }
        : undefined;
  }
}

/** `sellsOnly` — аудитория по покупкам: консультанту без продаж (BOVI) не показывается. */
const AUDIENCES: Array<{
  value: UiAudience;
  label: AdminKey;
  hint: AdminKey;
  tgOnly?: boolean;
  sellsOnly?: boolean;
}> = [
  { value: "all", label: "broadcasts.audience.all", hint: "broadcasts.audience.allHint" },
  {
    value: "buyers",
    label: "broadcasts.audience.buyers",
    hint: "broadcasts.audience.buyersHint",
    sellsOnly: true,
  },
  {
    value: "non_buyers",
    label: "broadcasts.audience.nonBuyers",
    hint: "broadcasts.audience.nonBuyersHint",
    sellsOnly: true,
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
  // Консультант без продаж (BOVI): корзины, покупок и «вернуть покупателя» у него нет.
  const sells = shop.sells !== false;
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
          {((sells && (shop.modules.cart_reminder || shop.modules.winback)) ||
            shop.modules.funnel) && <MarketingCapCard cap={data.marketingCap} />}
          {sells && shop.modules.cart_reminder && (
            <CartReminderCard hours={data.cartReminderHours} stats={data.autoStats?.cart} />
          )}
          {sells && shop.modules.winback && <WinbackCard stats={data.autoStats?.winback} />}
          {sells && shop.modules.waitlist && (
            <Card title={t("autostats.waitlistTitle")}>
              <AutoStatsBlock t={t} stats={data.autoStats?.waitlist} />
            </Card>
          )}
          {sells && shop.modules.winback && <SimilarCard t={t} stats={data.autoStats?.similar} />}
          {sells && (shop.modules.quiz || shop.modules.upsell) && (
            <Card title={t("engage.title")}>
              <EngageBlock
                t={t}
                stats={data.engage ?? undefined}
                quiz={Boolean(shop.modules.quiz)}
                upsell={Boolean(shop.modules.upsell)}
              />
            </Card>
          )}
          {shop.modules.funnel && <FunnelCard />}
          {shop.modules.funnel && <BirthdayCard />}
          {shop.modules.giveaways && <GiveawaysCard t={t} locale={intlLocale(shop.locale)} />}
          <History
            broadcasts={data.broadcasts}
            total={data.broadcastsTotal}
            onlyChannel={both ? channel : null}
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
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const set = (patch: Partial<SegmentDraft>) => onChange({ ...value, ...patch });
  // Потоки выбранного курса — для «ученики потока».
  const [cohorts, setCohorts] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    if (value.kind !== "course" || !value.productId) return setCohorts([]);
    void courseFn({ data: { productId: value.productId } }).then(
      (c) => setCohorts((c.cohorts ?? []).map((k) => ({ id: k.id, title: k.title || k.start }))),
      () => setCohorts([]),
    );
  }, [value.kind, value.productId]);
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <select
        className="input"
        aria-label={t("broadcasts.segment.kind")}
        value={value.kind}
        onChange={(e) => set({ kind: e.target.value as SegmentKind })}
      >
        {SEGMENT_KINDS.filter(
          (k) =>
            (k !== "course" || shop.modules.courses) &&
            (shop.sells !== false || !SALES_SEGMENTS.includes(k)),
        ).map((k) => (
          <option key={k} value={k}>
            {t(`broadcasts.segment.${k}` as AdminKey)}
          </option>
        ))}
      </select>
      {value.kind === "course" && (
        <>
          <div aria-label={t("broadcasts.segment.pickProduct")}>
            <ProductPicker
              t={t}
              value={
                value.productId
                  ? { id: value.productId, name: value.productName, price: 0, currency: "" }
                  : null
              }
              onChange={(p) =>
                set({ productId: p?.id ?? "", productName: p?.name ?? "", cohortId: "" })
              }
            />
          </div>
          <select
            className="input"
            value={value.who}
            onChange={(e) => set({ who: e.target.value as SegmentDraft["who"] })}
          >
            {(["all", "behind", "homework", "completed"] as const).map((w) => (
              <option key={w} value={w}>
                {t(`broadcasts.segment.who.${w}`)}
              </option>
            ))}
          </select>
          {cohorts.length > 0 && (
            <select
              className="input"
              value={value.cohortId}
              onChange={(e) => set({ cohortId: e.target.value })}
            >
              <option value="">{t("broadcasts.segment.allCohorts")}</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      {value.kind === "product" && (
        <div aria-label={t("broadcasts.segment.pickProduct")}>
          <ProductPicker
            t={t}
            value={
              value.productId
                ? { id: value.productId, name: value.productName, price: 0, currency: "" }
                : null
            }
            onChange={(p) => set({ productId: p?.id ?? "", productName: p?.name ?? "" })}
          />
        </div>
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
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const sells = shop.sells !== false;
  return (
    <div>
      <span className="label">{t("broadcasts.audience.label")}</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {AUDIENCES.filter(
          (a) => (channel === "telegram" || !a.tgOnly) && (sells || !a.sellsOnly),
        ).map((a) => (
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
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const router = useRouter();
  const [text, setText] = useState("");
  // A/B-тест: второй текст — половине аудитории (core/broadcasts/ab).
  const [abOn, setAbOn] = useState(false);
  const [textB, setTextB] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [giveawayId, setGiveawayId] = useState("");
  const search = Route.useSearch();
  // Консультант без продаж: сегментов по покупкам и дожима «не заказали» нет.
  const sells = shop.sells !== false;
  const preset = sells ? parseSegmentParam(search) : null;
  const navigate = Route.useNavigate();
  const followup = sells ? (search.followup ?? null) : null;
  const [audience, setAudience] = useState<UiAudience>(preset || followup ? "segment" : "all");
  const [country, setCountry] = useState(Object.keys(data.countries)[0] ?? "");
  const [segment, setSegment] = useState<SegmentDraft>(
    preset
      ? { ...EMPTY_SEGMENT, kind: "inactive", days: String(preset.days) }
      : sells
        ? EMPTY_SEGMENT
        : { ...EMPTY_SEGMENT, kind: "language" },
  );
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const seg =
    audience === "segment"
      ? followup
        ? { kind: "broadcast", id: followup, who: "no_order" }
        : segmentOf(segment)
      : undefined;
  const count = useAudienceCount("telegram", audience, country, seg);
  const scheduled = later && audience !== "test" && sendAt;

  const send = useAction(async () => {
    const isTest = audience === "test";
    if (!isTest && !confirm(t("broadcasts.compose.confirmTelegram", { n: count ?? "?" }))) return;
    await createBroadcastFn({
      data: {
        channel: "telegram",
        text,
        textB: abOn && !isTest && textB.trim() ? textB : undefined,
        photoKeys: photos,
        productIds: products.map((p) => p.id),
        showCatalog,
        giveawayId: giveawayId || undefined,
        audience: audience === "segment" ? "all" : audience,
        countryCode: audience === "country" ? country : undefined,
        segment: seg,
        // datetime-local — время браузера продавца; на сервер уходит абсолютное.
        sendAt: scheduled ? new Date(sendAt).toISOString() : undefined,
      },
    });
    if (!isTest) {
      setTextB("");
      setAbOn(false);
      setText("");
      setPhotos([]);
      setProducts([]);
      setShowCatalog(false);
      setGiveawayId("");
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

  const addProduct = (x: PickerProduct) =>
    setProducts((p) =>
      p.some((y) => y.id === x.id) || p.length >= MAX_PRODUCT_BUTTONS ? p : [...p, x],
    );
  const removeProduct = (id: string) => setProducts((p) => p.filter((x) => x.id !== id));

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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={abOn} onChange={(e) => setAbOn(e.target.checked)} />
          {t("broadcasts.ab.toggle")}
        </label>
        {abOn && (
          <Field label={t("broadcasts.ab.textB")} hint={t("broadcasts.ab.hint")}>
            <textarea
              className="input min-h-24"
              value={textB}
              maxLength={4000}
              onChange={(e) => setTextB(e.target.value)}
            />
          </Field>
        )}

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

        <div hidden={!sells && !shop.modules.giveaways}>
          <span className="label">{t("broadcasts.compose.buttons")}</span>
          {sells && (
            <div className="flex items-center gap-3 py-1">
              <Switch
                checked={showCatalog}
                onChange={setShowCatalog}
                label={t("broadcasts.compose.catalogSwitch")}
              />
              <span className="text-sm">{t("broadcasts.compose.catalogButton")}</span>
            </div>
          )}
          {shop.modules.giveaways && (
            <div className="mt-2">
              <GiveawayButtonPick t={t} value={giveawayId} onChange={setGiveawayId} />
            </div>
          )}
          {sells && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-muted">
                {t("broadcasts.compose.productButtons", {
                  n: products.length,
                  max: MAX_PRODUCT_BUTTONS,
                })}
              </summary>
              <div className="mt-2 space-y-2 rounded-md border border-line p-2">
                {products.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      aria-label="✕"
                      onClick={() => removeProduct(p.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {products.length < MAX_PRODUCT_BUTTONS && (
                  <ProductSearch t={t} onPick={addProduct} exclude={products.map((p) => p.id)} />
                )}
              </div>
            </details>
          )}
        </div>

        {followup ? (
          <div className="rounded-md border border-accent bg-accent/10 px-3 py-2 text-sm">
            <p className="font-medium">{t("broadcasts.followup.title")}</p>
            <p className="text-xs text-muted">{t("broadcasts.followup.hint")}</p>
            <p className="mt-2 text-sm text-muted">
              {t("broadcasts.audience.recipients")}{" "}
              <span className="font-medium text-fg tabular-nums">{count ?? "…"}</span>
            </p>
            <button
              type="button"
              className="btn-ghost mt-1 text-xs"
              onClick={() => {
                setAudience("all");
                void navigate({
                  search: { segment: undefined, days: undefined, followup: undefined },
                  replace: true,
                });
              }}
            >
              {t("broadcasts.followup.cancel")}
            </button>
          </div>
        ) : (
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
        )}

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

function History({
  broadcasts: firstPage,
  total,
  onlyChannel,
  showChannel,
}: {
  broadcasts: Broadcast[];
  total: number;
  onlyChannel: Channel | null;
  showChannel: boolean;
}) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  // Консультант без продаж: заказов и выручки от рассылки нет — их и не показываем.
  const sells = shop.sells !== false;
  const router = useRouter();
  // «Показать ещё»: страницы после первой, без повторов с обновлённой первой.
  const [more, setMore] = useState<Broadcast[]>([]);
  const firstIds = new Set(firstPage.map((b) => b.id));
  const loaded = [...firstPage, ...more.filter((b) => !firstIds.has(b.id))];
  const broadcasts = loaded.filter((b) => (onlyChannel ? b.channel === onlyChannel : true));
  const loadMore = useAction(async () => {
    const page = await moreBroadcastsFn({ data: { offset: loaded.length } });
    setMore((m) => [...m, ...page.broadcasts]);
  });
  const navigate = Route.useNavigate();
  const cancel = useAction(async (id: string) => {
    if (!confirm(t("broadcasts.history.confirmStop"))) return;
    await cancelBroadcastFn({ data: { id } });
    await router.invalidate();
  });
  const sides = (b: Broadcast): AbMoneySide => ({
    id: b.id,
    sent: b.sent_count,
    clicks: b.clicks,
    orders: b.revenue.orders,
    paid: b.revenue.paid,
    revenue: b.revenue.revenue,
  });
  // Пары A/B-теста: группа → оба варианта; сравнение рисуется один раз, под первым в списке.
  const pairs = new Map<string, { A?: Broadcast; B?: Broadcast }>();
  for (const b of broadcasts) {
    const ab = (b.audience_filter as { ab?: { group?: string; variant?: "A" | "B" } } | null)?.ab;
    if (!ab?.group || !ab.variant) continue;
    pairs.set(ab.group, { ...pairs.get(ab.group), [ab.variant]: b });
  }
  const comparisonShownFor = new Set<string>();
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
              ab?: { group?: string; variant?: "A" | "B" };
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
                      {filter.ab?.variant && (
                        <Badge tone="accent">
                          {t("broadcasts.ab.badge", { v: filter.ab.variant })}
                          {b.sent_count > 0 &&
                            ` · ${Math.round((b.clicks / b.sent_count) * 1000) / 10}%`}
                        </Badge>
                      )}
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
                  {sells &&
                    b.channel === "telegram" &&
                    b.status === "completed" &&
                    b.sent_count > 0 &&
                    !filter.ab &&
                    filter.segment?.kind !== "broadcast" && (
                      <button
                        className="btn-ghost text-xs"
                        disabled={b.revenue.windowOpen}
                        title={b.revenue.windowOpen ? t("broadcasts.followup.wait") : undefined}
                        onClick={() =>
                          void navigate({
                            search: { segment: undefined, days: undefined, followup: b.id },
                          }).then(() => window.scrollTo({ top: 0, behavior: "smooth" }))
                        }
                      >
                        {t("broadcasts.followup.button")}
                      </button>
                    )}
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
                {(() => {
                  const g = sells ? filter.ab?.group : undefined;
                  const pair = g ? pairs.get(g) : undefined;
                  if (!g || !pair || comparisonShownFor.has(g)) return null;
                  const state = abCompareState(pair.A, pair.B);
                  if (state === "notSent") return null;
                  if (state === "otherNotLoaded")
                    return (
                      <p className="mt-2 text-xs text-muted">{t("broadcasts.ab.otherBelow")}</p>
                    );
                  if (!pair.A || !pair.B) return null;
                  comparisonShownFor.add(g);
                  const v = abVerdict(sides(pair.A), sides(pair.B));
                  const row = (x: Broadcast, name: "A" | "B") => (
                    <li key={name} className={v.leader === name ? "font-medium text-ok" : ""}>
                      {t("broadcasts.ab.row", {
                        v: name,
                        clicks: x.clicks,
                        orders: x.revenue.orders,
                        money:
                          Object.entries(x.revenue.revenue)
                            .map(([cur, sum]) => formatMoney(sum, cur))
                            .join(", ") || "0",
                      })}
                    </li>
                  );
                  return (
                    <div className="mt-2 rounded-lg border border-line p-2 text-xs">
                      <p className="font-medium">{t("broadcasts.ab.compare")}</p>
                      <ul className="mt-1 space-y-0.5 tabular-nums">
                        {row(pair.A, "A")}
                        {row(pair.B, "B")}
                      </ul>
                      <p className="mt-1 text-muted">
                        {v.leader
                          ? t(
                              v.basis === "revenue"
                                ? "broadcasts.ab.winnerRevenue"
                                : "broadcasts.ab.winnerClicks",
                              { v: v.leader },
                            )
                          : t("broadcasts.ab.noWinner")}
                        {v.lowOrders && ` ${t("broadcasts.ab.lowOrders")}`}
                        {v.mixedCurrency && ` ${t("broadcasts.ab.mixedCurrency")}`}
                      </p>
                    </div>
                  );
                })()}
                {sells && b.sent_count > 0 && (
                  <p className="mt-1 text-xs text-muted tabular-nums">
                    <span className="font-medium text-fg">{t("broadcasts.revenue.label")}</span>{" "}
                    {t("broadcasts.revenue.orders", { n: b.revenue.orders, paid: b.revenue.paid })}
                    {Object.entries(b.revenue.revenue).map(([cur, sum]) => (
                      <span key={cur} className="text-ok">
                        {" · "}
                        {formatMoney(sum, cur)}
                      </span>
                    ))}
                    <span className="block">
                      {t("broadcasts.revenue.hint")}
                      {filter.segment?.kind === "broadcast" &&
                        ` ${t("broadcasts.revenue.hintFollowup")}`}
                      {b.revenue.windowOpen && ` ${t("broadcasts.revenue.windowOpen")}`}
                    </span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {loaded.length < total && (
        <button
          className="btn-secondary mt-3 text-sm"
          disabled={loadMore.busy}
          onClick={() => void loadMore.run().catch(() => {})}
        >
          {t("broadcasts.history.more", { n: total - loaded.length })}
        </button>
      )}
      <ErrorBox error={cancel.error ?? loadMore.error} />
    </Card>
  );
}

/** Общий потолок автосообщений (корзина, похожие, возврат, воронка) на покупателя в сутки. */
function MarketingCapCard({ cap }: { cap: string }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(cap);
  const save = useAction(async () => {
    await saveSettingsFn({ data: { marketing_daily_cap: value.trim() } });
    await router.invalidate();
  });
  return (
    <Card title={t("broadcasts.cap.title")}>
      <p className="mb-3 text-sm text-muted">{t("broadcasts.cap.intro")}</p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run().catch(() => {});
        }}
      >
        <Field label={t("broadcasts.cap.perDay")}>
          <input
            className="input w-32"
            type="number"
            min={0}
            max={10}
            step={1}
            value={value}
            placeholder="1"
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

function CartReminderCard({ hours, stats }: { hours: string; stats?: AutoStats }) {
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
      <AutoPreview t={t} kind="cart" />
      <AutoStatsBlock t={t} stats={stats} />
    </Card>
  );
}

/** Возвратные продажи: серия из двух сообщений тем, кто давно не заказывал. */
function WinbackCard({ stats }: { stats?: AutoStats }) {
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
      <AutoPreview t={t} kind="winback" draft={c} />
      <AutoStatsBlock t={t} stats={stats} />
    </Card>
  );
}

/** Поздравление с днём рождения (core/funnel/birthday). */
function BirthdayCard() {
  const t = useT();
  const [d, setD] = useState<Awaited<ReturnType<typeof birthdayFn>> | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void birthdayFn().then(setD);
  }, []);
  const save = useAction(async () => {
    if (!d) return;
    await saveBirthdayFn({ data: d.cfg });
    setSaved(true);
  });
  if (!d) return null;
  const set = (patch: Partial<typeof d.cfg>) => {
    setSaved(false);
    setD({ ...d, cfg: { ...d.cfg, ...patch } });
  };
  return (
    <Card title={t("birthday.title")}>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={d.cfg.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          {t("birthday.enabled")}
        </label>
        <Field label={t("birthday.text")} hint={t("birthday.textHint")}>
          <textarea
            className="input min-h-20"
            maxLength={2000}
            value={d.cfg.text}
            placeholder={t("birthday.placeholder")}
            onChange={(e) => set({ text: e.target.value })}
          />
        </Field>
        <Field label={t("birthday.promo")} hint={t("birthday.promoHint")}>
          <input
            className="input w-48"
            maxLength={40}
            value={d.cfg.promo}
            onChange={(e) => set({ promo: e.target.value })}
          />
        </Field>
        {d.link && (
          <p className="text-xs text-muted">
            {t("birthday.link")} <code className="rounded bg-surface-2 px-1">{d.link}</code>
          </p>
        )}
        <ErrorBox error={save.error} />
        <div className="flex items-center gap-3">
          <button
            className="btn-primary"
            disabled={save.busy}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("common.save")}
          </button>
          {saved && <span className="text-xs text-ok">{t("settings.saved")}</span>}
        </div>
      </div>
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
