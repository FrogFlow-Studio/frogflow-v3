/** Карточка клиента у оператора: Telegram-бот и вебхук; проверки и переключение переезда на v2. */
import { useState, type FormEvent } from "react";
import {
  connectTelegramFn,
  connectVipBotOperatorFn,
  reinstallWebhookFn,
  setServedByFn,
} from "@/app/operator/clients.functions";
import { Badge, Card, ErrorBox, Switch, useAction } from "@/app/ui";
import { ConfirmName } from "./ConfirmName";
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
  onDone,
}: {
  c: C;
  webhook: W;
  onDone: () => Promise<void>;
}) {
  const connect = useAction(async (token: string) => {
    await connectTelegramFn({ data: { botId: c.id, token } });
    await onDone();
  });
  const reinstall = useAction(async () => {
    await reinstallWebhookFn({ data: { botId: c.id } });
    await onDone();
  });
  const vip = useAction(async (token: string) => {
    await connectVipBotOperatorFn({ data: { botId: c.id, token } });
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
      {(c.modules.vip || c.vipBot.connected) && (
        <form
          className="mt-3 space-y-1"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void vip
              .run(String(f.get("vip_token")).trim())
              .then(() => (e.target as HTMLFormElement).reset?.())
              .catch(() => {});
          }}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">VIP-бот</span>
            {c.vipBot.connected ? (
              <Badge tone={c.vipBot.webhookOk ? "ok" : "neutral"}>
                @{c.vipBot.username ?? "бот"}
              </Badge>
            ) : (
              <Badge>не подключён</Badge>
            )}
          </div>
          <div className="flex gap-2">
            <input
              className="input"
              name="vip_token"
              placeholder={
                c.vipBot.connected ? "Новый токен VIP-бота" : "Токен VIP-бота из проекта Vercel v1"
              }
              autoComplete="off"
              required
            />
            <button className="btn-secondary shrink-0" disabled={vip.busy}>
              {c.vipBot.connected ? "Заменить" : "Подключить"}
            </button>
          </div>
          {c.servedBy !== "v2" && (
            <p className="text-xs text-muted">
              Пока клиент на v1, токен только сохраняется: вебхук VIP-бота переставится сюда при
              переключении на v2.
            </p>
          )}
        </form>
      )}
      <ErrorBox error={connect.error ?? reinstall.error ?? vip.error} />
      {webhook && (c.telegram.connected || c.servedBy === "v2") && (
        <div className="mt-4 rounded-md bg-surface-2 p-3 text-xs">
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
    </Card>
  );
}

/** Переезд на v2: проверки готовности и переключатель «обслуживает эта платформа» с подтверждением названием. */
export function MigrationCard({
  c,
  migration,
  onDone,
}: {
  c: C;
  migration: M;
  onDone: () => Promise<void>;
}) {
  // Итог переключения на v2: сколько тегов сторис перенесено и сколько не влезло.
  const [served, setServed] = useState<string | null>(null);
  const [asking, setAsking] = useState<"v1" | "v2" | null>(null);
  const serve = useAction(async (v: "v1" | "v2") => {
    setServed(null);
    const r = await setServedByFn({ data: { botId: c.id, servedBy: v } });
    await onDone();
    const tags = r && "storyTags" in r ? r.storyTags : undefined;
    const notes: string[] = [];
    if (tags && "error" in tags) notes.push(`Теги сторис не перенесены: ${tags.error}`);
    else if (tags && (tags.added || tags.dropped))
      notes.push(
        `Теги сторис: перенесено ${tags.added}` +
          (tags.dropped ? `, не влезло в предел ${tags.dropped}` : "") +
          ".",
      );
    const vipHook = r && "vip" in r ? r.vip : null;
    if (vipHook)
      notes.push(
        vipHook.ok
          ? "Вебхук VIP-бота переставлен сюда."
          : `Вебхук VIP-бота не переставлен (${vipHook.error ?? "ошибка Telegram"}): крон повторит в начале часа.`,
      );
    if (notes.length) setServed(notes.join(" "));
  });
  return (
    <Card title="Переезд на v2">
      <ErrorBox error={serve.error} />
      {served && <p className="text-xs text-muted">{served}</p>}
      {c.servedBy !== "v2" && <MigrationChecks m={migration} />}
      {(c.telegram.connected || c.servedBy === "v2") && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
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
            onChange={(on) => setAsking(on ? "v2" : "v1")}
            label="served by v2"
          />
        </div>
      )}
      {asking && (
        <ConfirmName
          name={c.name}
          title={asking === "v2" ? "Перевести клиента на v2?" : "Вернуть клиента на v1?"}
          text={
            asking === "v2"
              ? "Вебхук Telegram переставится на эту платформу, заказы и выдача пойдут через v2."
              : "Бот вернётся на деплой v1; вебхук там нужно переустановить."
          }
          confirmLabel={asking === "v2" ? "Перевести на v2" : "Вернуть на v1"}
          onConfirm={() => serve.run(asking)}
          onCancel={() => setAsking(null)}
        />
      )}
    </Card>
  );
}
