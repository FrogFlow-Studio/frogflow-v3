import { useRouteContext } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";
import { Card, Field } from "@/app/ui";
import { SOURCE_TAG_GROUP } from "@/core/analytics/source-funnel";
import {
  botSourceLink,
  SOURCE_TAG_MAX,
  sourceTag,
  storeSourceLink,
} from "@/core/analytics/source-links";

/** Общие части аналитики: источники, ссылки, плитки. */

const PLATFORM: Record<string, string> = {
  telegram: "Telegram",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

/** Подпись группы источника (core/analytics/source-funnel). */
export function sourceLabel(source: string, t: AdminT): string {
  if (source === "all") return t("analytics.sources.all");
  if (["search", "market", "link"].includes(source))
    return t(`growth.source.${source}` as "growth.source.search");
  if (["direct", "referral", "storefront", "product", "other"].includes(source))
    return t(`analytics.sources.${source}` as "analytics.sources.direct");
  if (source.startsWith(SOURCE_TAG_GROUP))
    return t("analytics.sources.tag", { label: source.slice(SOURCE_TAG_GROUP.length) });
  if (source.startsWith("site:"))
    return t("analytics.sources.site", { label: source.slice("site:".length) });
  return t("analytics.sources.bot", { label: source });
}

/** Строка ссылки: адрес и кнопка «Скопировать». */
function CopyLink({ label, url, t }: { label: string; url: string; t: AdminT }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер обмена недоступен (не https, запрет браузера): адрес выделяется для ручного копирования.
      field.current?.focus();
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-sm text-muted">{label}</span>
      <input
        ref={field}
        className="input min-w-0 flex-1 font-mono text-xs"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" className="btn-secondary text-xs" onClick={() => void copy()}>
        {copied ? t("analytics.links.copied") : t("analytics.links.copy")}
      </button>
    </div>
  );
}

/**
 * Генератор ссылок с меткой: t.me/<бот>?start=src_<метка> и витрина с
 * ?utm_source=<метка>. Метка разбирается в core/analytics/source-links.
 */
export function SourceLinksCard({ bot, store }: { bot: string | null; store: string | null }) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  const [input, setInput] = useState("");
  const parsed = sourceTag(input);
  const error =
    !parsed.ok && parsed.reason !== "empty" ? t(`analytics.links.err.${parsed.reason}`) : null;
  return (
    <Card title={t("analytics.links.title")} className="lg:col-span-2">
      <p className="mb-3 text-sm text-muted">{t("analytics.links.intro")}</p>
      <Field label={t("analytics.links.tag")}>
        <input
          className="input w-full max-w-sm"
          name="source-tag"
          maxLength={SOURCE_TAG_MAX * 2}
          placeholder={t("analytics.links.placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </Field>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {parsed.ok && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">{t("analytics.links.result", { tag: parsed.tag })}</p>
          {bot ? (
            <CopyLink label={t("analytics.links.bot")} url={botSourceLink(bot, parsed.tag)} t={t} />
          ) : (
            <p className="text-sm text-muted">{t("analytics.links.noBot")}</p>
          )}
          {store ? (
            <CopyLink
              label={t("analytics.links.store")}
              url={storeSourceLink(store, parsed.tag)}
              t={t}
            />
          ) : (
            <p className="text-sm text-muted">{t("analytics.links.noStore")}</p>
          )}
        </div>
      )}
    </Card>
  );
}

export function platformLabel(platform: string, t: AdminT): string {
  if (platform === "web") return t("analytics.platform.web");
  return PLATFORM[platform] ?? platform;
}

function Delta({ value, upIsGood = true }: { value: number | null; upIsGood?: boolean }) {
  const { shop } = useRouteContext({ from: "/admin/_authed" });
  const t = adminT(shop.locale);
  if (value === null) return <span className="text-muted">{t("analytics.delta.noPrev")}</span>;
  if (value === 0) return <span className="text-muted">{t("analytics.delta.same")}</span>;
  const good = value > 0 === upIsGood;
  return (
    <span className={good ? "text-ok" : "text-danger"}>
      {value > 0 ? "▲" : "▼"}{" "}
      {t("analytics.delta.vsPrev", {
        pct: Math.abs(value).toLocaleString(intlLocale(shop.locale)),
      })}
    </span>
  );
}

export function Tile({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: number | null;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs">
        <Delta value={delta} />
      </div>
    </div>
  );
}
