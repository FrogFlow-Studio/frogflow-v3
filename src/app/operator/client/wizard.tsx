/** Карточка клиента у оператора: где клиент застрял в мастере подключения Instagram/WhatsApp. */
import { useEffect, useState } from "react";
import { wizardViewFn } from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

type View = Awaited<ReturnType<typeof wizardViewFn>>;

const STEP = {
  login: "вход в аккаунт",
  webhook: "проверка связи",
  test: "тестовое сообщение",
  done: "готово",
} as const;

/** Причина и что делать оператору: клиенту то же самое показано в мастере его словами. */
const PROBLEM = {
  not_configured: "На платформе нет ключа Zernio: задайте ZERNIO_API_KEY.",
  conflict:
    "Аккаунт уже записан у другого клиента: освободите прежнее подключение или пусть войдёт другим аккаунтом.",
  expired: "Вход слетел: клиенту нужно войти заново.",
  unsure:
    "Ответ Zernio неизвестен (500 или обрыв): клиент должен нажать «Проверить», слепого повтора нет.",
  try_later: "Zernio был недоступен: пройдёт само, клиент повторит.",
  refused: "Zernio отказал (ключ, права): проверьте ключ и профиль клиента, повтор не поможет.",
  webhook_off:
    "Вебхук платформы не привязан к профилю клиента: «Настройки» → «Вебхук Zernio» → «Привязать».",
  webhook_error: "Вебхук Zernio не удалось прочитать: проверьте ключ и повторите.",
} as const;

const CHANNEL = { instagram: "Instagram", whatsapp: "WhatsApp" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("ru");

export function WizardCard({ c }: { c: C }) {
  const [v, setV] = useState<View | null>(null);
  const load = useAction(async () => setV(await wizardViewFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  if (!v || v.rows.length === 0) return <ErrorBox error={load.error} />;
  return (
    <Card title="Мастер подключения каналов">
      <ul className="space-y-2 text-sm">
        {v.rows.map((r) => (
          <li key={r.platform}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{CHANNEL[r.platform]}</span>
              <Badge tone={r.step === "done" ? "ok" : r.problem ? "warn" : undefined}>
                {STEP[r.step]}
              </Badge>
              <span className="text-muted">
                начал {when(r.startedAt)}, на этом шаге с {when(r.at)}
              </span>
            </div>
            {r.problem && <p className="mt-1 text-muted">{PROBLEM[r.problem]}</p>}
            {r.testAt && (
              <p className="mt-1 text-muted">Тестовое сообщение дошло {when(r.testAt)}.</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
