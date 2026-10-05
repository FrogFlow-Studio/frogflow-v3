import { useRef, useState } from "react";
import type { AdminT } from "@/app/i18n/admin";
import { qrSvg } from "@/core/share/share";

/** Строка со ссылкой или текстом и кнопкой «Скопировать»; буфер недоступен — поле выделяется для ручного копирования. */
export function CopyRow({
  label,
  value,
  t,
  multiline = false,
}: {
  label: string;
  value: string;
  t: AdminT;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      field.current?.focus();
      field.current?.select();
    }
  };
  return (
    <div className="space-y-1">
      <div className="text-sm text-muted">{label}</div>
      <div className="flex flex-wrap items-start gap-2">
        {multiline ? (
          <textarea
            ref={field}
            className="input min-h-28 min-w-0 flex-1 text-sm"
            readOnly
            value={value}
            aria-label={label}
          />
        ) : (
          <input
            ref={field}
            className="input min-w-0 flex-1 font-mono text-xs"
            readOnly
            value={value}
            aria-label={label}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <button type="button" className="btn-secondary text-xs" onClick={() => void copy()}>
          {copied ? t("share.copied") : t("share.copy")}
        </button>
      </div>
    </div>
  );
}

/** QR ссылки: SVG из библиотеки, не пользовательский ввод. */
export function Qr({ value, label }: { value: string; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="w-40 max-w-full rounded-md border border-line bg-white p-1"
      dangerouslySetInnerHTML={{ __html: qrSvg(value) }}
    />
  );
}
