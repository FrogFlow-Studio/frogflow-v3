import { Link, useRouter, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { retryText, screenErrorText } from "@/lib/shown-error";

/**
 * Единые «пусто» и «не удалось загрузить» для списков админки. Пустой список
 * объясняет, что это за раздел, и даёт кнопку «с чего начать»; сбой чтения —
 * не «ничего нет», а понятная фраза и «Повторить».
 */
export type EmptyAction =
  | { label: ReactNode; to: LinkProps["to"]; params?: Record<string, string>; onClick?: undefined }
  | { label: ReactNode; onClick: () => void; to?: undefined };

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: EmptyAction;
}) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-line px-4 py-10 text-center"
    >
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{hint}</p>}
      {action &&
        (action.to ? (
          <Link
            to={action.to}
            params={action.params as never}
            className="btn-primary mt-4 inline-block"
          >
            {action.label}
          </Link>
        ) : (
          <button type="button" className="btn-primary mt-4" onClick={action.onClick}>
            {action.label}
          </button>
        ))}
    </div>
  );
}

/** Сбой загрузки: фраза на языке панели (без сырого текста ошибки) и «Повторить» — перечитать данные страницы. */
export function LoadError({
  error,
  message,
  onRetry,
}: {
  error?: unknown;
  message?: ReactNode;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const lang = typeof document === "undefined" ? undefined : document.documentElement.lang;
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-6 text-center"
    >
      <p className="text-sm text-danger">{message ?? screenErrorText(error, lang)}</p>
      <button
        type="button"
        className="btn-secondary mt-3"
        onClick={() => (onRetry ? onRetry() : void router.invalidate())}
      >
        {retryText(lang)}
      </button>
    </div>
  );
}
