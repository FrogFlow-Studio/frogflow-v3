/**
 * Сигнал оператору, что модель ИИ-консультанта перестала отвечать не на
 * минуту, а насовсем (перенос из v1, consultant-v2/model-alert.ts). 25.09 в
 * v1 баланс Anthropic ушёл в минус, и об этом узнали по журналу через
 * несколько часов: консультант молча отдавал каждый диалог менеджеру. Ключ
 * Anthropic в v2 один на платформу, поэтому пишем оператору, а не продавцу.
 *
 * Движок пишет сбой в `consultant_last_error` клиента («<время> — HTTP 400:
 * …») и стирает его при удачном ответе; крон здоровья читает эту настройку у
 * клиентов v2 с включённым консультантом. Перегрузка (529), 5xx и сеть
 * проходят сами — о них не пишем. Не чаще раза в ALERT_EVERY_MS на вид сбоя
 * и только о сбое новее прошлого сообщения.
 */

export type ModelFailureKind = "billing" | "auth" | "no_key" | "limit";

export const ALERT_EVERY_MS = 3 * 60 * 60 * 1000;
export const LAST_ERROR_KEY = "consultant_last_error";
export const ENABLED_KEY = "consultant_enabled";

/** Вид сбоя по тексту ошибки движка или null, если сбой временный. */
export function classifyModelFailure(detail: string | null | undefined): ModelFailureKind | null {
  if (!detail) return null;
  const status = /HTTP (\d{3})/.exec(detail)?.[1];
  if (!status) return null;
  if (/credit balance|billing|payment/i.test(detail)) return "billing";
  if (status === "401" || status === "403") return "auth";
  if (status === "429") return "limit";
  return null;
}

/** «<ISO> — <текст>» из consultant_last_error; пусто или без даты — null. */
export function parseLastError(
  raw: string | null | undefined,
): { at: string; detail: string } | null {
  const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) — ([\s\S]+)$/.exec((raw ?? "").trim());
  return m ? { at: m[1]!, detail: m[2]! } : null;
}

export type ClientReading = {
  id: string;
  name: string;
  /** Включён ли консультант (настройка или ниша-консультант). */
  enabled: boolean;
  lastError: string | null;
};

/** Когда о виде сбоя писали последний раз (ISO) — состояние в operator_settings. */
export type AlertMarks = Partial<Record<ModelFailureKind, string>>;

export type ModelAlert = { kind: ModelFailureKind; clients: string[]; at: string };

/**
 * Что сообщить: по виду сбоя — клиенты, у которых он есть, если он новее
 * прошлого сообщения этого вида и с того прошло ALERT_EVERY_MS. Ключа
 * платформы нет, а консультант у кого-то включён — «no_key».
 */
export function modelAlerts(
  clients: readonly ClientReading[],
  marks: AlertMarks,
  keyConfigured: boolean,
  now: number,
): ModelAlert[] {
  const nowIso = new Date(now).toISOString();
  const due = (kind: ModelFailureKind, at: string) => {
    const last = Date.parse(marks[kind] ?? "");
    if (!Number.isFinite(last)) return true;
    return now - last >= ALERT_EVERY_MS && Date.parse(at) > last;
  };
  const on = clients.filter((c) => c.enabled);
  if (!keyConfigured)
    return on.length && due("no_key", nowIso)
      ? [{ kind: "no_key", clients: on.map((c) => c.name), at: nowIso }]
      : [];
  const byKind = new Map<ModelFailureKind, { clients: string[]; at: string }>();
  for (const c of on) {
    const e = parseLastError(c.lastError);
    const kind = classifyModelFailure(e?.detail);
    if (!e || !kind) continue;
    const g = byKind.get(kind) ?? { clients: [], at: e.at };
    g.clients.push(c.name);
    if (e.at > g.at) g.at = e.at;
    byKind.set(kind, g);
  }
  return [...byKind]
    .filter(([kind, g]) => due(kind, g.at))
    .map(([kind, g]) => ({ kind, clients: g.clients, at: g.at }));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function modelAlertText(a: ModelAlert): string {
  const head: Record<ModelFailureKind, string> = {
    billing: "⚠️ ИИ-консультант: на счёте Anthropic закончились деньги.",
    auth: "⚠️ ИИ-консультант: Anthropic не принимает ключ (отозван или неверный).",
    no_key: "⚠️ ИИ-консультант: в окружении платформы не задан ANTHROPIC_API_KEY.",
    limit: "⚠️ ИИ-консультант: Anthropic отклоняет запросы по лимиту (429).",
  };
  const hint: Record<ModelFailureKind, string> = {
    billing: "Пополнить: console.anthropic.com → Billing.",
    auth: "Проверьте ANTHROPIC_API_KEY в окружении Vercel.",
    no_key: "Задайте ANTHROPIC_API_KEY в окружении Vercel.",
    limit: "Проверьте лимиты: console.anthropic.com → Limits.",
  };
  const tail =
    a.kind === "limit"
      ? "Часть ответов уходит менеджеру."
      : "Пока это не исправлено, консультант не отвечает: каждый диалог уходит менеджеру.";
  const who = a.clients.slice(0, 10).map(esc).join(", ");
  const more = a.clients.length > 10 ? ` и ещё ${a.clients.length - 10}` : "";
  return `${head[a.kind]}\n${tail}\nКлиенты: ${who}${more}.\n${hint[a.kind]}`;
}
