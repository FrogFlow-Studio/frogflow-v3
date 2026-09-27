/** Карточка клиента у оператора: Telegram-бот, вебхук, проверки переезда на v2. */
import { type FormEvent } from "react";
import {
  connectTelegramFn,
  reinstallWebhookFn,
  setServedByFn,
} from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, Switch, useAction } from "@/app/ui";
import type { C, W, M } from "./types";

const LEVEL_TONE = { ok: "ok", info: "neutral", warn: "warn", block: "danger" } as const;
const LEVEL_MARK = { ok: "✓", info: "i", warn: "!", block: "✕" } as const;

/** Предполётная проверка переезда: что блокирует, что стоит поправить, что напомнить. */
function MigrationChecks({ m }: { m: M }) {
  return (
    <div className="rounded-md border border-line p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Готовность к переезду</span>
        <Badge tone={m.ready ? "ok" : "danger"}>{m.ready ? "можно переводить" : "не готов"}</Badge>
      </div>
      <ul className="space-y-1.5">
        {m.checks.map((ch) => (
          <li key={ch.key} className="flex items-start gap-2">
            <Badge tone={LEVEL_TONE[ch.level]}>{LEVEL_MARK[ch.level]}</Badge>
            <span>
              <span className="font-medium">{ch.title}</span>
              <span className="block text-muted">{ch.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TelegramCard({
  c,
  webhook,
  migration,
  onDone,
}: {
  c: C;
  webhook: W;
  migration: M;
  onDone: () => Promise<void>;
}) {
  const connect = useAction(async (token: string) => {
    await connectTelegramFn({ data: { botId: c.id, token } });
    await onDone();
  });
  const serve = useAction(async (v: "v1" | "v2") => {
    await setServedByFn({ data: { botId: c.id, servedBy: v } });
    await onDone();
  });
  const reinstall = useAction(async () => {
    await reinstallWebhookFn({ data: { botId: c.id } });
    await onDone();
  });
  return (
    <Card
      title="Telegram"
      actions={
        c.telegram.connected ? (
          <Badge tone="ok">@{c.telegram.username ?? "бот"}</Badge>
        ) : (
          <Badge>не подключён</Badge>
        )
      }
    >
      <form
        className="flex gap-2"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void connect
            .run(String(f.get("token")).trim())
            .then(() => (e.target as HTMLFormElement).reset?.())
            .catch(() => {});
        }}
      >
        <input
          className="input"
          name="token"
          placeholder={
            c.telegram.connected ? "Новый токен, если бот сменился" : "Токен из BotFather"
          }
          autoComplete="off"
          required
        />
        <button className="btn-secondary shrink-0" disabled={connect.busy}>
          {c.telegram.connected ? "Заменить" : "Подключить"}
        </button>
      </form>
      <ErrorBox error={connect.error ?? serve.error ?? reinstall.error} />
      {c.servedBy !== "v2" && (
        <div className="mt-4">
          <MigrationChecks m={migration} />
        </div>
      )}
      {(c.telegram.connected || c.servedBy === "v2") && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">Обслуживает эта платформа</div>
              <div className="text-xs text-muted">
                {c.servedBy === "v2"
                  ? "Выключите — бот вернётся на деплой v1 (там переустановите вебхук)."
                  : migration.ready
                    ? "Включите — вебхук переставится сюда, заказы и выдача пойдут через v2."
                    : "Пока не готов: сначала уберите блокирующие пункты выше."}
              </div>
            </div>
            <Switch
              checked={c.servedBy === "v2"}
              disabled={serve.busy || (c.servedBy !== "v2" && !migration.ready)}
              onChange={(on) => void serve.run(on ? "v2" : "v1").catch(() => {})}
              label="served by v2"
            />
          </div>
          {webhook && (
            <div className="rounded-md bg-surface-2 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span>
                  Вебхук{" "}
                  {webhook.ok ? (
                    <Badge tone="ok">на этом деплое</Badge>
                  ) : (
                    <Badge tone="warn">{webhook.url ? "на другом адресе" : "не установлен"}</Badge>
                  )}
                </span>
                <button
                  className="btn-ghost text-xs"
                  disabled={reinstall.busy || c.servedBy !== "v2"}
                  onClick={() => void reinstall.run().catch(() => {})}
                >
                  Переустановить
                </button>
              </div>
              <div className="mt-1 truncate font-mono text-muted">{webhook.url ?? "—"}</div>
              {webhook.pending > 0 && (
                <div className="mt-1 text-warn">В очереди Telegram: {webhook.pending}</div>
              )}
              {webhook.error && <div className="mt-1 text-danger">{webhook.error}</div>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
