/** Карточка клиента у оператора: Instagram/WhatsApp (Zernio) и данные клиента. */
import { useEffect, useState, type FormEvent } from "react";
import {
  adoptZernioProfileFn,
  clientZernioInboxFn,
  disconnectZernioAccountFn,
  unmatchedZernioFn,
  setZernioAccountsFn,
  syncZernioFn,
  updateClientMetaFn,
} from "@/app/operator/operator.functions";
import { VERTICAL_KEYS, VERTICALS } from "@/core/verticals/registry";
import { Badge, Card, ErrorBox, Field, useAction } from "@/app/ui";
import type { C } from "./types";

export function ZernioCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof syncZernioFn>> | null>(null);
  const sync = useAction(async () => {
    setResult(await syncZernioFn({ data: { botId: c.id } }));
    await onDone();
  });
  const zr = useAction(async (ids: string[]) => {
    await setZernioAccountsFn({ data: { botId: c.id, accountIds: ids } });
    await onDone();
  });
  const adopt = useAction(async (profileId: string) => {
    setResult(await adoptZernioProfileFn({ data: { botId: c.id, profileId } }));
    await onDone();
  });
  const off = useAction(async (id: string, name: string) => {
    if (
      !window.confirm(
        `Отключить ${name}? Аккаунт отключится и в Zernio, бот перестанет в нём отвечать. Переписка, заказы и покупатели останутся. Вернуть аккаунт можно только новым подключением.`,
      )
    )
      return;
    await disconnectZernioAccountFn({ data: { botId: c.id, accountId: id } });
    await onDone();
  });
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ru") : "—");
  const manual = c.zernioAccounts.filter((id) => !c.zernio.accounts.some((a) => a.id === id));
  return (
    <Card
      title="Instagram и WhatsApp (Zernio)"
      actions={
        // Новый профиль клиенту с профилем v1 не создаём: его Instagram остался бы в старом.
        (c.zernio.profileId || !c.zernio.seenProfileId) && (
          <button
            className="btn-secondary text-xs"
            disabled={sync.busy}
            onClick={() => void sync.run().catch(() => {})}
          >
            {sync.busy ? "Сверяем…" : c.zernio.profileId ? "Сверить аккаунты" : "Создать профиль"}
          </button>
        )
      }
    >
      <p className="text-xs text-muted">
        Ключ Zernio один на платформу, клиенты различаются профилем. События аккаунтов ниже попадают
        этому клиенту, когда профиль привязан к вебхуку v2 («Настройки платформы» → «Вебхук
        Zernio»).
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Профиль</dt>
        <dd className="font-mono">{c.zernio.profileId ?? "не создан"}</dd>
        <dt className="text-muted">Сверка</dt>
        <dd>{when(c.zernio.syncedAt)}</dd>
        <dt className="text-muted">Последнее событие</dt>
        <dd>{when(c.zernio.lastEventAt)}</dd>
      </dl>
      {c.zernio.accounts.length > 0 && (
        <table className="table mt-3">
          <thead>
            <tr>
              <th>Канал</th>
              <th>Аккаунт</th>
              <th>Состояние</th>
              <th>Событие</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {c.zernio.accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.platform === "whatsapp" ? "WhatsApp" : "Instagram"}</td>
                <td>
                  {a.username ? `@${a.username}` : (a.name ?? "")}{" "}
                  <span className="font-mono text-xs text-muted">{a.id}</span>
                </td>
                <td>
                  {a.expired ? (
                    <Badge tone="danger">отключён</Badge>
                  ) : (
                    <Badge tone="ok">подключён</Badge>
                  )}
                </td>
                <td className="text-muted">{when(a.lastEventAt)}</td>
                <td>
                  <button
                    className="btn-secondary text-xs"
                    disabled={off.busy}
                    onClick={() =>
                      void off
                        .run(a.id, a.username ? `@${a.username}` : (a.name ?? a.id))
                        .catch(() => {})
                    }
                  >
                    Отключить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result && result.conflicts.length > 0 && (
        <p className="mt-2 text-xs text-danger">
          Не отданы этому клиенту (уже у другого):{" "}
          {result.conflicts
            .map((x) => `${x.username ? `@${x.username}` : x.id} — ${x.ownerName}`)
            .join(", ")}
        </p>
      )}
      <ErrorBox error={sync.error ?? off.error} />
      {c.zernio.seenProfileId && c.zernio.seenProfileId !== c.zernio.profileId && (
        <form
          className="mt-4 space-y-3 border-t border-line pt-4"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const id = String(new FormData(e.currentTarget).get("profile")).trim();
            void adopt.run(id).catch(() => {});
          }}
        >
          <Field
            label="Профиль Zernio из v1"
            hint="События клиента приходят из этого профиля. Привяжите его до переезда, а не создавайте новый: Instagram не придётся подключать заново, вебхук v2 получит события именно этого профиля."
          >
            <input
              className="input font-mono"
              name="profile"
              defaultValue={c.zernio.seenProfileId}
            />
          </Field>
          <button className="btn-secondary" disabled={adopt.busy}>
            {adopt.busy ? "Привязываем…" : "Привязать профиль v1"}
          </button>
          <ErrorBox error={adopt.error} />
        </form>
      )}
      <form
        className="mt-4 space-y-3 border-t border-line pt-4"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const ids = String(new FormData(e.currentTarget).get("zernio"))
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          void zr.run(ids).catch(() => {});
        }}
      >
        <Field
          label="Идентификаторы аккаунтов вручную"
          hint={
            manual.length
              ? `Вне снимка профиля: ${manual.join(", ")}. Аккаунт, записанный у другого клиента, сохранить не даст.`
              : "Обычно не нужно: сверка заполняет список сама. Аккаунт, записанный у другого клиента, сохранить не даст."
          }
        >
          <input className="input" name="zernio" defaultValue={c.zernioAccounts.join(", ")} />
        </Field>
        <button className="btn-secondary" disabled={zr.busy}>
          Сохранить аккаунты
        </button>
        <ErrorBox error={zr.error} />
      </form>
    </Card>
  );
}

export function MetaCard({ c, onDone }: { c: C; onDone: () => Promise<void> }) {
  const save = useAction(async (f: FormData) => {
    const tg = String(f.get("ownerTelegramId")).trim();
    await updateClientMetaFn({
      data: {
        botId: c.id,
        name: String(f.get("name")),
        vertical: String(f.get("vertical")),
        ownerName: String(f.get("ownerName")) || null,
        ownerContact: String(f.get("ownerContact")) || null,
        ownerTelegramId: tg ? Number(tg) : null,
        notes: String(f.get("notes")) || null,
        pausedMessage: String(f.get("pausedMessage")) || null,
      },
    });
    await onDone();
  });
  return (
    <Card title="Карточка">
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          void save.run(new FormData(e.currentTarget)).catch(() => {});
        }}
      >
        <Field label="Название">
          <input className="input" name="name" defaultValue={c.name} required />
        </Field>
        <Field label="Ниша">
          <select className="input" name="vertical" defaultValue={c.vertical}>
            {VERTICAL_KEYS.map((k) => (
              <option key={k} value={k}>
                {VERTICALS[k].title}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Владелец">
            <input className="input" name="ownerName" defaultValue={c.ownerName ?? ""} />
          </Field>
          <Field label="Контакт">
            <input className="input" name="ownerContact" defaultValue={c.ownerContact ?? ""} />
          </Field>
        </div>
        <Field
          label="Telegram ID владельца"
          hint="Получает уведомления о заказах вместе со списком admin_chat_id."
        >
          <input
            className="input"
            name="ownerTelegramId"
            defaultValue={c.ownerTelegramId ?? ""}
            inputMode="numeric"
          />
        </Field>
        <Field label="Текст бота на паузе">
          <input
            className="input"
            name="pausedMessage"
            defaultValue={c.pausedMessage ?? ""}
            placeholder="Бот временно недоступен…"
          />
        </Field>
        <Field label="Заметки">
          <textarea className="input" name="notes" rows={3} defaultValue={c.notes ?? ""} />
        </Field>
        <button className="btn-secondary" disabled={save.busy}>
          Сохранить
        </button>
        <ErrorBox error={save.error} />
      </form>
    </Card>
  );
}

type InboxRow = Awaited<ReturnType<typeof clientZernioInboxFn>>[number];

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  processed: "ok",
  ignored: "neutral",
  received: "warn",
  retrying: "warn",
  failed: "danger",
};

/**
 * Входящие строками, а не таблицей: на телефоне широкая таблица распирала
 * колонку и наезжала на соседние карточки.
 */
export function InboxTable({ rows, withAccount }: { rows: InboxRow[]; withAccount?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Событий нет.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {rows.map((r, i) => (
        <li key={`${r.at}-${i}`} className="min-w-0 py-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted">{new Date(r.at).toLocaleString("ru")}</span>
            <span>{r.sender ?? "—"}</span>
            <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
            {r.note && <span className="break-words text-muted">{r.note}</span>}
          </div>
          {withAccount && r.account && (
            <div className="break-all font-mono text-xs text-muted">{r.account}</div>
          )}
          {r.text && <div className="break-words">{r.text}</div>}
        </li>
      ))}
    </ul>
  );
}

function useRows(load: () => Promise<InboxRow[]>, key: string) {
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let off = false;
    setError(null);
    load()
      .then((r) => !off && setRows(r))
      .catch((e) => !off && setError(e));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return { rows, error, refresh: () => setNonce((n) => n + 1) };
}

/**
 * Входящие Instagram/WhatsApp клиента с итогом: «бот молчит» — видно почему
 * (автоответчик выключен, менеджер ведёт диалог, строгий режим…).
 */
export function ZernioInboxCard({ botId }: { botId: string }) {
  const { rows, error, refresh } = useRows(() => clientZernioInboxFn({ data: { botId } }), botId);
  return (
    <Card
      title="Входящие Instagram/WhatsApp"
      actions={
        <button className="btn-secondary text-xs" onClick={refresh}>
          Обновить
        </button>
      }
    >
      <p className="mb-2 text-xs text-muted">
        Последние 20 событий и чем кончилась обработка. Нет вашего сообщения — событие не дошло до
        этого клиента: смотрите «Без клиента» в настройках платформы.
      </p>
      {rows ? (
        <InboxTable rows={rows} />
      ) : (
        !error && <p className="text-sm text-muted">Загрузка…</p>
      )}
      <ErrorBox error={error} />
    </Card>
  );
}

/** События, дошедшие до v2 без клиента: аккаунт не привязан или клиент ещё на v1. */
export function UnmatchedZernioCard() {
  const { rows, error, refresh } = useRows(() => unmatchedZernioFn(), "all");
  return (
    <Card
      title="Instagram/WhatsApp без клиента"
      actions={
        <button className="btn-secondary text-xs" onClick={refresh}>
          Обновить
        </button>
      }
    >
      <p className="mb-2 text-xs text-muted">
        Сообщения, которые дошли до v2, но ни одному клиенту v2 не достались: аккаунт не привязан
        (карточка клиента → Zernio → «Сверить аккаунты») или клиент ещё на v1. Хранятся неделю.
      </p>
      {rows ? (
        <InboxTable rows={rows} withAccount />
      ) : (
        !error && <p className="text-sm text-muted">Загрузка…</p>
      )}
      <ErrorBox error={error} />
    </Card>
  );
}
