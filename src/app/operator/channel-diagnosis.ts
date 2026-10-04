/**
 * Диагностика канала клиента одной кнопкой: список «ок / не ок / что сделать».
 * Чистые функции над собранными фактами; сами факты читает `channel-diagnosis.server.ts`.
 * Ничего не повторяет и никому не пишет: только чтение (getMe, getWebhookInfo, список
 * аккаунтов и вебхуков Zernio, журнал событий).
 *
 * Причины Zernio разбирает `channels/zernio/errors.ts` (по статусу и кодам, не по тексту).
 */
import { classifyZernioFailure, type ZernioFailure } from "@/channels/zernio/errors";
import { ZERNIO_WEBHOOK_EVENTS } from "@/channels/zernio/webhook-fit";

export type DiagChannel = "telegram" | "instagram" | "whatsapp";

/** ok — в порядке, bad — не в порядке, info — сведения (данных нет или проверять нечего). */
export type DiagState = "ok" | "bad" | "info";

export type DiagCheck = {
  key: string;
  title: string;
  state: DiagState;
  detail: string;
  /** Что сделать; только у `bad`. */
  todo?: string;
};

export type Diagnosis = {
  channel: DiagChannel;
  /** bad, если не в порядке хотя бы один пункт. */
  verdict: "ok" | "bad";
  checks: DiagCheck[];
};

/** Ошибка доставки обновлений Telegram свежая, если ей меньше суток. */
export const RECENT_DELIVERY_ERROR_MS = 24 * 3_600_000;
/** Ошибка отправки в WhatsApp считается свежей неделю. */
export const RECENT_SEND_ERROR_MS = 7 * 86_400_000;

const verdictOf = (checks: DiagCheck[]): "ok" | "bad" =>
  checks.some((c) => c.state === "bad") ? "bad" : "ok";

const when = (iso: string) =>
  new Date(iso).toLocaleString("ru", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Almaty",
  });

/* ── Telegram ─────────────────────────────────────────────────────── */

export type TelegramFacts = {
  servedBy: "v1" | "v2" | null;
  tokenSet: boolean;
  /** null — не спрашивали (токена нет). */
  me: { ok: true; username: string | null } | { ok: false; code: number | null } | null;
  /** null — не спрашивали (клиент на v1 или токен не принят). */
  webhook:
    | {
        url: string | null;
        expected: string;
        pending: number;
        lastErrorAt: string | null;
        lastErrorMessage: string | null;
      }
    | { error: string }
    | null;
  /** Последнее принятое обновление из журнала; null — нет за срок хранения; undefined — журнал не прочитан. */
  lastEventAt: string | null | undefined;
  now: Date;
};

export function diagnoseTelegram(f: TelegramFacts): Diagnosis {
  const checks: DiagCheck[] = [];
  if (!f.tokenSet) {
    checks.push({
      key: "token",
      title: "Токен бота",
      state: "bad",
      detail: "Токен не задан, бот не подключён.",
      todo: "Вставьте токен из BotFather на вкладке «Каналы» и нажмите «Подключить».",
    });
    return { channel: "telegram", verdict: "bad", checks };
  }
  checks.push({ key: "token", title: "Токен бота", state: "ok", detail: "Токен задан." });

  if (f.me?.ok) {
    checks.push({
      key: "alive",
      title: "Токен жив",
      state: "ok",
      detail: f.me.username ? `Telegram знает бота @${f.me.username}.` : "Telegram принял токен.",
    });
  } else if (f.me && f.me.code !== null && (f.me.code === 401 || f.me.code === 404)) {
    checks.push({
      key: "alive",
      title: "Токен жив",
      state: "bad",
      detail: `Telegram не принял токен (код ${f.me.code}): бот удалён или токен перевыпущен.`,
      todo: "Возьмите новый токен в BotFather и нажмите «Заменить» на вкладке «Каналы».",
    });
  } else {
    checks.push({
      key: "alive",
      title: "Токен жив",
      state: "bad",
      detail: "Telegram не ответил: токен не проверен.",
      todo: "Повторите проверку позже. Ничего не отправлялось и не повторялось.",
    });
  }

  if (f.servedBy !== "v2") {
    checks.push({
      key: "webhook",
      title: "Вебхук",
      state: "info",
      detail: "Клиента обслуживает прежняя платформа: вебхук держит она, здесь он не проверяется.",
    });
  } else if (!f.webhook) {
    checks.push({
      key: "webhook",
      title: "Вебхук",
      state: "info",
      detail: "Вебхук не проверен: токен не принят.",
    });
  } else if ("error" in f.webhook) {
    checks.push({
      key: "webhook",
      title: "Вебхук",
      state: "bad",
      detail: `Не удалось спросить Telegram о вебхуке: ${f.webhook.error}.`,
      todo: "Повторите проверку позже.",
    });
  } else {
    const w = f.webhook;
    if (w.url === w.expected) {
      checks.push({
        key: "webhook",
        title: "Вебхук",
        state: "ok",
        detail: `Привязан к этой платформе${w.pending > 0 ? `, в очереди Telegram: ${w.pending}` : ""}.`,
      });
    } else {
      checks.push({
        key: "webhook",
        title: "Вебхук",
        state: "bad",
        detail: w.url ? `Привязан к другому адресу: ${w.url}.` : "Вебхук не установлен.",
        todo: "Нажмите «Переустановить» в карточке Telegram на вкладке «Каналы».",
      });
    }
    const recent =
      w.lastErrorAt !== null &&
      f.now.getTime() - Date.parse(w.lastErrorAt) < RECENT_DELIVERY_ERROR_MS;
    checks.push(
      recent
        ? {
            key: "last-error",
            title: "Последняя ошибка доставки",
            state: "bad",
            detail: `${when(w.lastErrorAt!)}: ${w.lastErrorMessage ?? "Telegram не смог доставить обновление"}.`,
            todo: "Проверьте, что платформа отвечает, и переустановите вебхук. Если ошибка повторяется — смотрите журнал платформы.",
          }
        : {
            key: "last-error",
            title: "Последняя ошибка доставки",
            state: "ok",
            detail: "За последние сутки Telegram ошибок доставки не сообщал.",
          },
    );
  }

  if (f.lastEventAt === undefined) {
    checks.push({
      key: "last-event",
      title: "Последнее событие",
      state: "info",
      detail: "Журнал событий не прочитан.",
    });
  } else if (f.lastEventAt === null) {
    checks.push({
      key: "last-event",
      title: "Последнее событие",
      state: "info",
      detail:
        f.servedBy === "v2"
          ? "В журнале платформы обновлений нет (журнал хранится 30 дней)."
          : "Журнал этой платформы не ведётся: клиента обслуживает прежняя.",
    });
  } else {
    checks.push({
      key: "last-event",
      title: "Последнее событие",
      state: "ok",
      detail: `Последнее обновление принято ${when(f.lastEventAt)}.`,
    });
  }
  return { channel: "telegram", verdict: verdictOf(checks), checks };
}

/* ── Instagram и WhatsApp (Zernio) ────────────────────────────────── */

export type ZernioFacts = {
  servedBy: "v1" | "v2" | null;
  /** Ключ Zernio задан на платформе. */
  keySet: boolean;
  profileId: string | null;
  /** Аккаунты этого канала в снимке клиента. */
  accounts: Array<{ id: string; username: string | null; expired: boolean }>;
  /** Ответ Zernio на список аккаунтов профиля; null — не спрашивали. */
  live:
    | { ok: true; accounts: Array<{ id: string; platform: string; expired: boolean }> }
    | { ok: false; failure: ZernioFailure | null; error: string }
    | null;
  /** Записи вебхуков Zernio: своя запись этого деплоя и что она покрывает; null — не спрашивали. */
  webhook:
    | { error: string }
    | {
        own: null | {
          active: boolean;
          profileIds: string[];
          events: string[];
        };
      }
    | null;
  /** Последнее событие вебхука по этому клиенту; null — нет; undefined — журнал не прочитан. */
  lastEventAt: string | null | undefined;
  /** Последний отказ доставки (`message.failed`); null — нет. */
  lastFailed: { at: string; reason: string } | null | undefined;
  now: Date;
};

const CHANNEL_TITLE = { instagram: "Instagram", whatsapp: "WhatsApp" } as const;

export function diagnoseZernio(channel: "instagram" | "whatsapp", f: ZernioFacts): Diagnosis {
  const title = CHANNEL_TITLE[channel];
  const checks: DiagCheck[] = [];

  if (!f.keySet) {
    checks.push({
      key: "key",
      title: "Ключ Zernio",
      state: "bad",
      detail: "На платформе не задан ключ Zernio (ZERNIO_API_KEY).",
      todo: "Добавьте ключ в окружение платформы и сделайте Redeploy: пока его нет, каналы не работают ни у одного клиента.",
    });
    return { channel, verdict: "bad", checks };
  }
  checks.push({ key: "key", title: "Ключ Zernio", state: "ok", detail: "Ключ задан." });

  if (!f.profileId) {
    checks.push({
      key: "profile",
      title: "Профиль клиента",
      state: "bad",
      detail: "У клиента нет профиля Zernio.",
      todo: "Нажмите «Создать профиль» в карточке Instagram и WhatsApp на вкладке «Каналы», затем подключите аккаунт.",
    });
    return { channel, verdict: "bad", checks };
  }
  checks.push({ key: "profile", title: "Профиль клиента", state: "ok", detail: f.profileId });

  if (f.accounts.length === 0) {
    checks.push({
      key: "account",
      title: `Аккаунт ${title}`,
      state: "bad",
      detail: `В снимке клиента нет аккаунта ${title}.`,
      todo: `Подключите аккаунт ${title} и нажмите «Сверить аккаунты» на вкладке «Каналы».`,
    });
  } else {
    const expired = f.accounts.filter((a) => a.expired);
    checks.push(
      expired.length > 0
        ? {
            key: "account",
            title: `Аккаунт ${title}`,
            state: "bad",
            detail: `Авторизация истекла: ${expired.map((a) => (a.username ? `@${a.username}` : a.id)).join(", ")}.`,
            todo: `Переподключите аккаунт ${title} и нажмите «Сверить аккаунты».`,
          }
        : {
            key: "account",
            title: `Аккаунт ${title}`,
            state: "ok",
            detail: f.accounts.map((a) => (a.username ? `@${a.username}` : a.id)).join(", "),
          },
    );
  }

  if (f.live === null) {
    checks.push({
      key: "live",
      title: "Состояние в Zernio",
      state: "info",
      detail: "Не проверялось.",
    });
  } else if (!f.live.ok) {
    const kind = classifyZernioFailure(f.live.failure);
    if (kind === "permanent") {
      checks.push({
        key: "live",
        title: "Состояние в Zernio",
        state: "bad",
        detail: `Zernio отказал в запросе${f.live.failure?.status ? ` (код ${f.live.failure.status})` : ""}: ключ не подходит или нет доступа.`,
        todo: "Проверьте ZERNIO_API_KEY в окружении платформы.",
      });
    } else {
      checks.push({
        key: "live",
        title: "Состояние в Zernio",
        state: "bad",
        detail:
          kind === "rate_limited"
            ? "Zernio ограничил частоту запросов."
            : "Zernio не ответил: состояние аккаунта неизвестно.",
        todo: "Повторите проверку позже. Ничего не отправлялось и не повторялось.",
      });
    }
  } else {
    const known = new Set(f.accounts.map((a) => a.id));
    const mine = f.live.accounts.filter((a) => a.platform === channel && known.has(a.id));
    const missing = f.accounts.filter((a) => !mine.some((m) => m.id === a.id));
    if (f.accounts.length > 0 && missing.length > 0) {
      checks.push({
        key: "live",
        title: "Состояние в Zernio",
        state: "bad",
        detail: `Аккаунта нет в Zernio (отключён там): ${missing.map((a) => (a.username ? `@${a.username}` : a.id)).join(", ")}.`,
        todo: `Подключите аккаунт ${title} заново и нажмите «Сверить аккаунты».`,
      });
    } else if (mine.some((a) => a.expired)) {
      checks.push({
        key: "live",
        title: "Состояние в Zernio",
        state: "bad",
        detail: "Zernio сообщает: авторизация аккаунта истекла.",
        todo: `Переподключите аккаунт ${title} и нажмите «Сверить аккаунты».`,
      });
    } else if (f.accounts.length > 0) {
      checks.push({
        key: "live",
        title: "Состояние в Zernio",
        state: "ok",
        detail: "Zernio видит аккаунт, авторизация действует.",
      });
    }
  }

  if (f.servedBy !== "v2") {
    checks.push({
      key: "webhook",
      title: "Вебхук Zernio",
      state: "info",
      detail: "Клиента обслуживает прежняя платформа: события принимает её вебхук.",
    });
  } else if (f.webhook === null) {
    checks.push({
      key: "webhook",
      title: "Вебхук Zernio",
      state: "info",
      detail: "Не проверялось.",
    });
  } else if ("error" in f.webhook) {
    checks.push({
      key: "webhook",
      title: "Вебхук Zernio",
      state: "bad",
      detail: `Не удалось прочитать вебхуки Zernio: ${f.webhook.error}.`,
      todo: "Повторите проверку позже.",
    });
  } else {
    const own = f.webhook.own;
    const fix =
      "Откройте «Настройки» оператора, «Вебхук Zernio», нажмите «Проверить» и «Привязать».";
    if (!own) {
      checks.push({
        key: "webhook",
        title: "Вебхук Zernio",
        state: "bad",
        detail: "Записи вебхука этой платформы в Zernio нет.",
        todo: fix,
      });
    } else if (!own.active) {
      checks.push({
        key: "webhook",
        title: "Вебхук Zernio",
        state: "bad",
        detail: "Запись вебхука этой платформы выключена.",
        todo: fix,
      });
    } else if (!f.profileId || !own.profileIds.includes(f.profileId)) {
      checks.push({
        key: "webhook",
        title: "Вебхук Zernio",
        state: "bad",
        detail: "Профиль клиента не входит в вебхук этой платформы: события не приходят.",
        todo: fix,
      });
    } else {
      const lacking = ZERNIO_WEBHOOK_EVENTS.filter((e) => !own.events.includes(e));
      checks.push(
        lacking.length > 0
          ? {
              key: "webhook",
              title: "Вебхук Zernio",
              state: "bad",
              detail: `Вебхук не подписан на события: ${lacking.join(", ")}.`,
              todo: fix,
            }
          : {
              key: "webhook",
              title: "Вебхук Zernio",
              state: "ok",
              detail: "Профиль клиента привязан, подписка на события полная.",
            },
      );
    }
  }

  if (f.lastEventAt === undefined) {
    checks.push({
      key: "last-event",
      title: "Последнее событие",
      state: "info",
      detail: "Журнал событий не прочитан.",
    });
  } else {
    checks.push({
      key: "last-event",
      title: "Последнее событие",
      state: f.lastEventAt ? "ok" : "info",
      detail: f.lastEventAt
        ? `Вебхук получил событие ${when(f.lastEventAt)}.`
        : "Событий в журнале нет (журнал хранится 30 дней).",
    });
  }

  if (channel === "whatsapp") {
    if (f.lastFailed === undefined) {
      checks.push({
        key: "send-error",
        title: "Последняя ошибка отправки",
        state: "info",
        detail: "Журнал не прочитан.",
      });
    } else if (f.lastFailed === null) {
      checks.push({
        key: "send-error",
        title: "Последняя ошибка отправки",
        state: "ok",
        detail: "Отказов доставки в журнале нет.",
      });
    } else {
      const recent = f.now.getTime() - Date.parse(f.lastFailed.at) < RECENT_SEND_ERROR_MS;
      checks.push({
        key: "send-error",
        title: "Последняя ошибка отправки",
        state: recent ? "bad" : "info",
        detail: `${when(f.lastFailed.at)}: ${f.lastFailed.reason}.`,
        ...(recent
          ? {
              todo: "Это отказ по одному покупателю, не поломка канала. Если такие отказы идут подряд у разных покупателей, проверьте авторизацию аккаунта.",
            }
          : {}),
      });
    }
  } else {
    checks.push({
      key: "send-error",
      title: "Последняя ошибка отправки",
      state: "info",
      detail:
        "Instagram не сообщает о недоставленных сообщениях (у Zernio нет такого события): ошибку видно только в момент отправки, в журнале её нет.",
    });
  }
  return { channel, verdict: verdictOf(checks), checks };
}
