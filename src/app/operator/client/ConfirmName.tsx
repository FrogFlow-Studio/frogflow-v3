import { useState } from "react";
import { ErrorBox } from "@/app/ui";
import { nameMatches } from "./confirm-name";

/**
 * Окно подтверждения опасного действия: кнопка включается, когда введено название клиента.
 * Действие выполняется один раз: пока оно идёт, кнопка закрыта.
 */
export function ConfirmName({
  name,
  title,
  text,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  name: string;
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ok = nameMatches(typed, name);
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="card w-full max-w-md space-y-3 p-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-muted">{text}</p>
        <label className="block text-sm">
          Введите название клиента: <span className="font-medium">{name}</span>
          <input
            className="input mt-1"
            aria-label="Название клиента для подтверждения"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!ok || busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void onConfirm()
                .then(onCancel)
                .catch((e) => setError(e))
                .finally(() => setBusy(false));
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
