import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { botTextsFn, saveBotTextFn, saveWorkHoursFn } from "@/app/admin/bot-texts.functions";
import type { BotTextRow } from "@/app/admin/bot-texts.server";
import { adminT, type AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox, Field, PageTitle, useAction } from "@/app/ui";
import {
  BOT_TEXT_CHANNELS,
  BOT_TEXT_MAX,
  fillText,
  sampleVars,
  unknownVars,
  type BotTextChannel,
} from "@/core/bot-texts/registry";
import { localeFlags, localeNames, type Locale } from "@/core/i18n/locale";

export const Route = createFileRoute("/admin/_authed/bot-texts")({
  loader: () => botTextsFn(),
  component: BotTextsPage,
});

function Bubble({ text }: { text: string }) {
  return (
    <div className="max-w-sm rounded-2xl rounded-bl-sm border border-line bg-surface px-3 py-2 text-sm whitespace-pre-wrap">
      {text}
    </div>
  );
}

function TextEditor({
  row,
  channel,
  locale,
  shopName,
  hours,
  t,
}: {
  row: BotTextRow;
  channel: BotTextChannel;
  locale: Locale;
  shopName: string;
  hours: { open: number; close: number } | null;
  t: AdminT;
}) {
  const router = useRouter();
  const saved = row.custom[channel]?.[locale] ?? "";
  const [value, setValue] = useState(saved);
  const [done, setDone] = useState(false);
  const vars = sampleVars(shopName, hours);
  const shown = value.trim() ? value : row.standard[locale];
  const unknown = unknownVars(row.key, value);
  const save = useAction(async (next: string) => {
    await saveBotTextFn({ data: { key: row.key, channel, texts: { [locale]: next || null } } });
    setValue(next);
    setDone(true);
    await router.invalidate();
  });
  const sendable = !row.optIn || value.trim() !== "";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field
        label={`${t("botTexts.custom")} · ${localeFlags[locale]} ${localeNames[locale]}`}
        hint={
          row.vars.length
            ? t("botTexts.vars", {
                vars: row.vars.map((v) => t(`botTexts.var.${v}` as never)).join("; "),
              })
            : undefined
        }
      >
        <textarea
          className="input min-h-28"
          value={value}
          maxLength={BOT_TEXT_MAX}
          placeholder={row.standard[locale]}
          onChange={(e) => {
            setValue(e.target.value);
            setDone(false);
          }}
        />
      </Field>
      <div>
        <div className="label">{t("botTexts.preview")}</div>
        {sendable ? (
          <Bubble text={fillText(shown, vars)} />
        ) : (
          <p className="text-sm text-muted">{t("botTexts.noCustom")}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        {unknown.map((n) => (
          <span key={n} className="text-xs text-warn">
            {t("botTexts.unknownVar", { name: `{${n}}` })}
          </span>
        ))}
        <button
          className="btn-primary"
          disabled={save.busy || value === saved}
          onClick={() => void save.run(value).catch(() => {})}
        >
          {t("botTexts.save")}
        </button>
        <button
          className="btn-secondary"
          disabled={save.busy || !saved}
          onClick={() => void save.run("").catch(() => {})}
        >
          {t("botTexts.reset")}
        </button>
        {done && <span className="text-xs text-ok">{t("botTexts.saved")}</span>}
        <ErrorBox error={save.error} />
      </div>
    </div>
  );
}

function HoursCard({
  hours,
  t,
  sells,
  pricelist,
}: {
  hours: { open: number; close: number } | null;
  t: AdminT;
  sells: boolean;
  pricelist: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<number | "">(hours?.open ?? "");
  const [close, setClose] = useState<number | "">(hours?.close ?? "");
  const save = useAction(async (next: { open: number; close: number } | null) => {
    await saveWorkHoursFn({ data: { hours: next } });
    if (!next) {
      setOpen("");
      setClose("");
    }
    await router.invalidate();
  });
  const valid = open !== "" && close !== "" && open !== close;
  const options = Array.from({ length: 25 }, (_, h) => h);
  return (
    <Card title={t("botTexts.hours.title")}>
      {sells ? (
        <p className="mb-3 text-sm text-muted">{t("botTexts.hours.hint")}</p>
      ) : (
        // Консультант без продаж: у него три разных «часа» — говорим, какие где.
        <div className="mb-3 space-y-1 text-sm text-muted">
          <p>{t("botTexts.hours.hintTelegramOnly")}</p>
          {pricelist && (
            <p>
              <Link to="/admin/pricelist" className="text-accent hover:underline">
                {t("botTexts.hours.hintPricelist", { page: t("pricelist.nav") })}
              </Link>
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("botTexts.hours.open")}>
          <select
            className="input"
            value={open}
            onChange={(e) => setOpen(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">{t("botTexts.hours.none")}</option>
            {options.map((h) => (
              <option key={h} value={h}>{`${String(h % 24).padStart(2, "0")}:00`}</option>
            ))}
          </select>
        </Field>
        <Field label={t("botTexts.hours.close")}>
          <select
            className="input"
            value={close}
            onChange={(e) => setClose(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">{t("botTexts.hours.none")}</option>
            {options.map((h) => (
              <option key={h} value={h}>{`${String(h % 24).padStart(2, "0")}:00`}</option>
            ))}
          </select>
        </Field>
        <button
          className="btn-primary"
          disabled={save.busy || !valid}
          onClick={() =>
            void save.run({ open: open as number, close: close as number }).catch(() => {})
          }
        >
          {t("botTexts.hours.save")}
        </button>
        <button
          className="btn-secondary"
          disabled={save.busy || !hours}
          onClick={() => void save.run(null).catch(() => {})}
        >
          {t("botTexts.hours.clear")}
        </button>
      </div>
      <ErrorBox error={save.error} />
    </Card>
  );
}

function BotTextsPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const [channel, setChannel] = useState<BotTextChannel>("telegram");
  const [locale, setLocale] = useState<Locale>(data.locales[0]!);
  // Консультант без продаж (BOVI): заказов нет — и «Спасибо за заказ» не показываем.
  const sells = shop.sells !== false;
  const wired = (data.channels.find((c) => c.channel === channel)?.wired ?? []).filter(
    (k) => sells || k !== "order_thanks",
  );
  return (
    <>
      <PageTitle title={t("botTexts.title")} subtitle={t("botTexts.subtitle")} />
      <div className="mb-4 flex flex-wrap gap-2">
        {BOT_TEXT_CHANNELS.map((c) => (
          <button
            key={c}
            className={c === channel ? "btn-primary" : "btn-secondary"}
            onClick={() => setChannel(c)}
          >
            {t(`botTexts.channel.${c}`)}
          </button>
        ))}
      </div>
      {data.locales.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data.locales.map((l) => (
            <button
              key={l}
              className={l === locale ? "btn-primary" : "btn-secondary"}
              onClick={() => setLocale(l)}
            >
              {localeFlags[l]} {localeNames[l]}
            </button>
          ))}
        </div>
      )}
      {wired.length === 0 &&
        (sells ? (
          <p className="mb-4 text-sm text-muted">{t("botTexts.notWired")}</p>
        ) : (
          <p className="mb-4 text-sm text-muted">
            {t("botTexts.notWiredConsultant")}{" "}
            <Link to="/admin/consultant" className="text-accent hover:underline">
              {t("botTexts.openConsultant")}
            </Link>
          </p>
        ))}
      <div className="space-y-4">
        {wired.length > 0 &&
          data.rows
            .filter((r) => wired.includes(r.key))
            .map((row) => (
              <Card key={`${row.key}:${channel}:${locale}`} title={t(`botTexts.key.${row.key}`)}>
                <p className="mb-3 text-sm text-muted">{t(`botTexts.key.${row.key}.hint`)}</p>
                <TextEditor
                  row={row}
                  channel={channel}
                  locale={locale}
                  shopName={data.shopName}
                  hours={data.workHours}
                  t={t}
                />
              </Card>
            ))}
        <HoursCard hours={data.workHours} t={t} sells={sells} pricelist={Boolean(shop.pricelist)} />
      </div>
    </>
  );
}
