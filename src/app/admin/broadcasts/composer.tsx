import { GiveawayButtonPick } from "@/app/admin/giveaways-card";
import { getRouteApi, useRouteContext, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { createBroadcastFn } from "@/app/admin/broadcasts.functions";
import { ProductSearch, type PickerProduct } from "@/app/admin/product-picker";
import { Card, Empty, ErrorBox, Field, Switch, useAction } from "@/app/ui";
import { imagePath } from "@/core/catalog/image-url";
import { MAX_PHOTOS, MAX_PRODUCT_BUTTONS, type AudienceType } from "@/core/broadcasts/pure";
import { parseSegmentParam } from "@/core/broadcasts/segment-link";
import {
  type Data,
  EMPTY_SEGMENT,
  type SegmentDraft,
  type UiAudience,
  type WhatsApp,
  segmentOf,
  uploadImage,
  useT,
} from "./shared";
import { AudiencePicker, useAudienceCount } from "./audience";
import { HelpTip } from "@/app/admin/help-panel";

/** Поиск и переход страницы рассылок: компонент вынесен из файла маршрута. */
const Route = getRouteApi("/admin/_authed/broadcasts");

export function Composer({
  data,
  botId,
  disabled,
}: {
  data: Data;
  botId: string;
  disabled: boolean;
}) {
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
          <HelpTip article="broadcasts" anchor="ab" />
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
          <span className="label flex items-center gap-1.5">
            {t("broadcasts.compose.buttons")}
            <HelpTip article="broadcasts" anchor="buttons" />
          </span>
          {sells && (
            <div className="flex items-center gap-3 py-1">
              <Switch
                checked={showCatalog}
                onChange={setShowCatalog}
                label={t("broadcasts.compose.catalogSwitch")}
              />
              <span className="text-sm">{t("broadcasts.compose.catalogButton")}</span>
              <HelpTip article="broadcasts" anchor="buttons" />
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
            <HelpTip article="broadcasts" anchor="schedule" />
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

export function WhatsAppComposer({
  data,
  wa,
  disabled,
}: {
  data: Data;
  wa: WhatsApp;
  disabled: boolean;
}) {
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
            <Field
              label={t("broadcasts.compose.fromNumber")}
              help={<HelpTip article="broadcasts" anchor="whatsapp" />}
            >
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
            help={<HelpTip article="broadcasts" anchor="whatsapp" />}
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
