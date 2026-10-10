import { randomUUID } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  claimStateSection,
  getCustomer,
  updateStateSection,
  type Customer,
  type DialogState,
} from "@/core/customers/customers";
import { serverFailure } from "@/lib/server-failure";

/**
 * Один ход консультанта на диалог (BOVI 08.10, разбор). Покупатель пишет
 * подряд «Здравствуйте» / «Есть полотенца?» / «А белые?» — каждый вебхук
 * раньше запускал свой runConsultant параллельно: все читали одну историю,
 * каждый звал модель и слал ответ, а запись истории последнего затирала
 * остальных. Покупатель получал два-три ответа, поздний не видел ранних
 * вопросов.
 *
 * Теперь сообщение сначала встаёт в очередь диалога `state.consultant.inbox`,
 * а ход консультанта идёт под арендой `state.consultant.turn` ({id, until}).
 * Обе записи — claimStateSection: условие на маленький счётчик
 * `state.consultant.rev` (и `state.mode`), патч переприменяется к свежему
 * состоянию, так что соседние сообщения не теряются.
 *
 * - Аренда свободна — сообщение берёт её и отвечает сразу за всё, что ждёт
 *   в очереди (своё и соседей).
 * - Аренда занята — сообщение ждёт: исчезло из очереди — его забрал чужой ход,
 *   отдельного ответа нет; аренда освободилась — берёт её и отвечает за всё,
 *   что накопилось (второе и третье сообщения — одним ответом).
 * - Функция умерла посреди хода — аренда истекает через LEASE_MS, ожидающий
 *   берёт её и отвечает и за брошенные сообщения. Тупика нет.
 *
 * Ход закрывается одной записью (commitTurn): реплики покупателя и ответ
 * дописываются к свежей истории, взятые сообщения уходят из очереди, аренда
 * снимается. Отправка покупателю — после этой записи (адаптер), так что
 * второй ход видит первый ответ в истории.
 */
export const BURST = {
  /**
   * Срок аренды: потолок раундов модели (ROUNDS_DEADLINE_MS, 35 с) и чтение
   * прайса, броней, истории до него. Дольше ход не длится — иначе сосед
   * считает функцию умершей.
   */
  leaseMs: 50_000,
  /**
   * Сколько ждёт сообщение за чужим ходом: чуть дольше аренды, чтобы забрать
   * брошенный ход. Ожидание плюс свой ход (до 50 с) — меньше 120 с функции.
   */
  waitMs: 55_000,
  /** Как часто ожидающий перечитывает состояние. Тесты ставят единицы мс. */
  pollMs: 1_500,
  /**
   * Сколько ход ждёт после взятия аренды, прежде чем собрать очередь (BOVI
   * 10.10, tolkin8): три фото одним касанием — три вебхука Zernio с разницей в
   * доли секунды. Первый брал ход сразу и отвечал на одно фото, остальные —
   * следующими ходами: три ответа подряд, каждый с «Здравствуйте». Ждёт
   * только ход с фото (engine.server): пауза короче, чем покупатель ждёт
   * ответа, и в аренду (50 с) укладывается.
   */
  settleMs: 2_500,
};

/**
 * Старше этого сообщение покупателя не отвечается: канал доставил его с
 * опозданием (Zernio повторяет вебхук часами). Как MAX_AGE_MS опроса v1
 * (consultant/inbox-poll.ts): 15 минут.
 */
export const STALE_INCOMING_MS = 15 * 60_000;

/** Не больше стольких сообщений в очереди диалога: состояние остаётся маленьким. */
const INBOX_MAX = 20;
const INBOX_TEXT = 500;
/** Ссылок на фото у одного сообщения в очереди (как MAX_IMAGES_PER_TURN). */
const INBOX_IMAGES = 3;
/** Длиннее ссылку не храним: обрезанная ссылка не скачается, а состояние раздуется. */
const INBOX_IMAGE_URL = 2_000;

export type InboxItem = {
  id: string;
  text: string;
  at: string;
  /**
   * Ссылки на фото покупателя (директ). Фото по ссылке скачивает тот ход,
   * который заберёт сообщение, — поэтому пачку фото отвечает один ход.
   */
  images?: string[];
  /**
   * Сообщение, которое может ответить только своя функция: публикация
   * (пометка сторис собирается в ней) или уже скачанные фото Telegram —
   * они живут только в её памяти. Чужой ход его не берёт.
   */
  own?: true;
};
export type TurnLease = { id: string; until: string };

export type JoinedTurn =
  | {
      lead: true;
      turnId: string;
      /** Id своего сообщения в очереди. */
      ownId: string;
      /** Покупатель со свежим состоянием — после взятия аренды. */
      customer: Customer;
      /** Сообщения этого хода по порядку: своё и соседей. */
      items: InboxItem[];
    }
  /** folded — сообщение забрал чужой ход. */
  | { lead: false; why: "folded" }
  /**
   * busy — чужой ход держит аренду дольше ожидания (завис или очень долгий).
   * Сообщение ещё в очереди; вызывающий закрывает его сам (releaseUnanswered),
   * иначе оно ждало бы следующего сообщения покупателя, а оно может не прийти.
   */
  | { lead: false; why: "busy"; ownId: string };

/** Сообщение написано давно: канал доставил его с опозданием. */
export function isStaleIncoming(sentAt: string | null | undefined, now = Date.now()): boolean {
  const at = Date.parse(sentAt ?? "");
  return Number.isFinite(at) && now - at > STALE_INCOMING_MS;
}

export function inboxOf(cur: Record<string, unknown>): InboxItem[] {
  const raw = cur.inbox;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (i): i is InboxItem =>
      Boolean(i) &&
      typeof i === "object" &&
      typeof (i as InboxItem).id === "string" &&
      typeof (i as InboxItem).text === "string",
  );
}

export function leaseOf(cur: Record<string, unknown>): TurnLease | null {
  const t = cur.turn as Partial<TurnLease> | undefined;
  return t && typeof t === "object" && typeof t.id === "string" && typeof t.until === "string"
    ? { id: t.id, until: t.until }
    : null;
}

function leaseLive(cur: Record<string, unknown>, now: number): boolean {
  const l = leaseOf(cur);
  return Boolean(l) && Date.parse(l!.until) > now;
}

/** Что ход берёт из очереди: всё, кроме чужих сообщений с фото. */
function takeable(inbox: InboxItem[], ownId: string): InboxItem[] {
  return inbox.filter((i) => !i.own || i.id === ownId);
}

function withLease(
  cur: Record<string, unknown>,
  turnId: string,
  now: number,
): Record<string, unknown> {
  return { ...cur, turn: { id: turnId, until: new Date(now + BURST.leaseMs).toISOString() } };
}

async function readConsultant(
  ctx: TenantContext,
  customer: Customer,
): Promise<Record<string, unknown>> {
  const { data, error } = await ctx.db
    .from("bot_users")
    .select("state")
    .eq("user_key", customer.userKey)
    .maybeSingle();
  if (error)
    throw serverFailure(`Не удалось прочитать состояние ${customer.userKey}: ${error.message}`);
  if (!data) throw serverFailure(`Покупатель ${customer.userKey} не найден`);
  const c = ((data.state ?? {}) as DialogState).consultant;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Встать в очередь диалога и получить ход (или узнать, что сообщение ушло в
 * чужой ход). Повтор того же id (двойная доставка) в очередь второй раз не встаёт.
 */
export async function joinTurn(
  ctx: TenantContext,
  customer: Customer,
  msg: { id?: string | null; text: string; own?: boolean; images?: string[] },
): Promise<JoinedTurn> {
  const turnId = randomUUID();
  const images = (msg.images ?? [])
    .filter((u) => u.length <= INBOX_IMAGE_URL)
    .slice(0, INBOX_IMAGES);
  const item: InboxItem = {
    id: msg.id || turnId,
    text: msg.text.slice(0, INBOX_TEXT),
    at: new Date().toISOString(),
    ...(images.length ? { images } : {}),
    ...(msg.own ? { own: true as const } : {}),
  };
  const lead = (c: Customer): JoinedTurn => {
    const cur = (c.state.consultant ?? {}) as Record<string, unknown>;
    return {
      lead: true,
      turnId,
      ownId: item.id,
      customer: c,
      items: takeable(inboxOf(cur), item.id),
    };
  };
  // Первая запись: в очередь и, если аренда свободна, сразу ход.
  let tookLease = false;
  const joined = await updateStateSection(ctx, customer, "consultant", (cur) => {
    const now = Date.now();
    const inbox = inboxOf(cur);
    const next = {
      ...cur,
      inbox: (inbox.some((i) => i.id === item.id) ? inbox : [...inbox, item]).slice(-INBOX_MAX),
    };
    tookLease = !leaseLive(cur, now);
    return tookLease ? withLease(next, turnId, now) : next;
  });
  if (tookLease) return lead(joined);

  const deadline = Date.now() + BURST.waitMs;
  while (Date.now() < deadline) {
    await sleep(BURST.pollMs);
    const cur = await readConsultant(ctx, customer);
    if (!inboxOf(cur).some((i) => i.id === item.id)) return { lead: false, why: "folded" };
    if (leaseLive(cur, Date.now())) continue;
    // Аренда свободна или брошена — берём её условной записью: из двух ждущих выигрывает один.
    const claimed = await claimStateSection(ctx, customer, "consultant", (fresh) => {
      const now = Date.now();
      if (!inboxOf(fresh).some((i) => i.id === item.id)) return null;
      if (leaseLive(fresh, now)) return null;
      return withLease(fresh, turnId, now);
    });
    if (claimed) return lead(claimed);
  }
  // Не дождались: сообщение пока в очереди, закрывает его вызывающий (releaseUnanswered).
  return { lead: false, why: "busy", ownId: item.id };
}

/**
 * Ход взят — подождать BURST.settleMs и собрать очередь заново: сообщения и
 * фото, пришедшие следом за первым, уходят в этот же ход, а не в следующий.
 * Аренда за это время ушла (не должно быть: она втрое дольше) — ход как был.
 */
export async function settleTurn(
  ctx: TenantContext,
  turn: Extract<JoinedTurn, { lead: true }>,
): Promise<Extract<JoinedTurn, { lead: true }>> {
  if (BURST.settleMs <= 0) return turn;
  await sleep(BURST.settleMs);
  const fresh = await getCustomer(ctx, turn.customer.userKey);
  if (!fresh) return turn;
  const raw = (fresh.state as DialogState).consultant;
  const cur =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (leaseOf(cur)?.id !== turn.turnId) return turn;
  const items = takeable(inboxOf(cur), turn.ownId);
  if (!items.some((i) => i.id === turn.ownId)) return turn;
  return { ...turn, customer: fresh, items };
}

/**
 * Закрыть ход одной записью поверх свежего состояния: реплики покупателя и
 * ответ — в конец свежей истории (а не поверх снимка начала хода), взятые
 * сообщения — из очереди, аренда снимается, если она ещё наша. `patch` —
 * прочие поля хода (профиль, пауза, последний ответ).
 */
export async function commitTurn(
  ctx: TenantContext,
  customer: Customer,
  turn: {
    turnId: string | null;
    items: Array<Pick<InboxItem, "id" | "text">>;
    reply?: string;
    historyTurns: number;
    patch?: (cur: Record<string, unknown>) => Record<string, unknown>;
  },
): Promise<Customer> {
  return updateStateSection(ctx, customer, "consultant", (cur) => {
    const base = turn.patch ? turn.patch(cur) : { ...cur };
    const taken = new Set(turn.items.map((i) => i.id));
    const recent = Array.isArray(cur.recent) ? (cur.recent as unknown[]) : [];
    const next: Record<string, unknown> = {
      ...base,
      recent: [
        ...recent,
        ...turn.items.map((i) => ({ role: "customer", text: i.text.slice(0, INBOX_TEXT) })),
        ...(turn.reply !== undefined
          ? [{ role: "assistant", text: turn.reply.slice(0, 700) }]
          : []),
      ].slice(-turn.historyTurns),
    };
    const inbox = inboxOf(cur).filter((i) => !taken.has(i.id));
    if (inbox.length) next.inbox = inbox;
    else delete next.inbox;
    if (turn.turnId && leaseOf(cur)?.id === turn.turnId) delete next.turn;
    return next;
  });
}

/**
 * Сообщение, не дождавшееся хода: из очереди — в историю диалога (реплика
 * покупателя видна следующему ходу и менеджеру), без ответа модели. Если
 * чужой ход успел его забрать, commitTurn ничего не дублирует: id уже нет в
 * очереди, а реплика уйдёт в историю с тем ходом — тогда false.
 */
export async function releaseUnanswered(
  ctx: TenantContext,
  customer: Customer,
  item: Pick<InboxItem, "id" | "text">,
  historyTurns: number,
  patch?: (cur: Record<string, unknown>) => Record<string, unknown>,
): Promise<boolean> {
  let mine = false;
  await updateStateSection(ctx, customer, "consultant", (cur) => {
    mine = inboxOf(cur).some((i) => i.id === item.id);
    if (!mine) return cur;
    const base = patch ? patch(cur) : { ...cur };
    const recent = Array.isArray(cur.recent) ? (cur.recent as unknown[]) : [];
    const next: Record<string, unknown> = {
      ...base,
      recent: [...recent, { role: "customer", text: item.text.slice(0, INBOX_TEXT) }].slice(
        -historyTurns,
      ),
    };
    const inbox = inboxOf(cur).filter((i) => i.id !== item.id);
    if (inbox.length) next.inbox = inbox;
    else delete next.inbox;
    return next;
  });
  return mine;
}
