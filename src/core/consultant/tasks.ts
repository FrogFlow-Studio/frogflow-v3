import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { pricelistMode } from "@/core/consultant/pricelist/mode";
import { updateSettingStamped } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { sha256Hex } from "@/lib/hash";

/**
 * Задачи консультанта (перенос v1 src/lib/consultant/tasks.ts): каждая
 * передача менеджеру — покупка, опт, жалоба, «позовите человека», вопрос без
 * ответа — строка в списке продавца в админке, которую он отмечает сделанной
 * или убирает. Уведомление в Telegram уходит как раньше; список — история и
 * место, где видно, что ещё не разобрано.
 *
 * Хранение — как у v1: строка `app_settings.consultant_tasks_json` (JSON-
 * массив) у клиента. Задачи BOVI, заведённые v1 до переезда, видны и здесь;
 * поля v2 (канал, имя, товары, ссылка на диалог) v1 при чтении пропускает.
 * Запись условна по `updated_at` (updateSettingStamped): массив больше 8 КБ,
 * условие на всё значение дало бы 431.
 */
export const TASKS_KEY = "consultant_tasks_json";

/**
 * Сколько задач держит список. Лишние уходят сначала из сделанных (старые
 * первыми), и только если открытых больше предела — самые старые открытые.
 * У v1 было 80 без разбора сделанных.
 */
export const TASKS_LIMIT = 200;

export type TaskChannel = "telegram" | "instagram" | "whatsapp";

/**
 * Чем закрыта задача: `manual` — продавец нажал «Сделано», остальное —
 * менеджер ответил покупателю (ответ свайпом в Telegram, «Чат» панели,
 * прямо в приложении Instagram/WhatsApp) и задача закрылась сама.
 */
export type TaskCloseVia = "manual" | "telegram" | "panel" | "instagram" | "whatsapp";
const CLOSE_VIA: readonly TaskCloseVia[] = ["manual", "telegram", "panel", "instagram", "whatsapp"];

export type ConsultantTask = {
  id: string;
  /** Когда передали менеджеру (ISO). */
  at: string;
  userKey: string;
  /** Причина передачи: purchase, wholesale, complaint, human_requested, photo, unknown_question… */
  reason: string;
  /** Суть от консультанта (что хотел покупатель, что уже известно). */
  text: string;
  /** Телефон или ник покупателя. */
  contact?: string;
  done: boolean;
  /** v2: канал диалога. */
  channel?: TaskChannel;
  /** v2: как зовут покупателя. */
  name?: string;
  /** v2: товары, о которых шла речь (строка: название, размер, цвет, цена). */
  products?: string[];
  /** v2: ссылка, открывающая диалог (ig.me, wa.me, t.me, входящие Direct). */
  link?: string;
  /** v2: когда отметили сделанной. */
  doneAt?: string;
  /** v2: чем закрыта (кнопкой или ответом менеджера покупателю). */
  doneVia?: TaskCloseVia;
};

const MAX = { text: 600, contact: 300, name: 120, product: 200, products: 5, link: 300 };

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

const CHANNELS: readonly TaskChannel[] = ["telegram", "instagram", "whatsapp"];

/** Строка списка из JSON (свой формат и формат v1); кривые записи пропускаются. */
function taskFrom(raw: unknown): ConsultantTask | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 100);
  const userKey = str(r.userKey, 200);
  if (!id || !userKey) return null;
  const at = typeof r.at === "string" && Number.isFinite(Date.parse(r.at)) ? r.at : null;
  if (!at) return null;
  const products = Array.isArray(r.products)
    ? r.products
        .map((p) => str(p, MAX.product))
        .filter((p): p is string => Boolean(p))
        .slice(0, MAX.products)
    : [];
  const link = str(r.link, MAX.link);
  return {
    id,
    at,
    userKey,
    reason: str(r.reason, 60) ?? "handoff",
    text: typeof r.text === "string" ? r.text.slice(0, MAX.text) : "",
    done: r.done === true,
    ...(str(r.contact, MAX.contact) ? { contact: str(r.contact, MAX.contact) } : {}),
    ...(CHANNELS.includes(r.channel as TaskChannel) ? { channel: r.channel as TaskChannel } : {}),
    ...(str(r.name, MAX.name) ? { name: str(r.name, MAX.name) } : {}),
    ...(products.length ? { products } : {}),
    ...(link && /^https:\/\//i.test(link) ? { link } : {}),
    ...(typeof r.doneAt === "string" ? { doneAt: r.doneAt } : {}),
    ...(r.done === true && CLOSE_VIA.includes(r.doneVia as TaskCloseVia)
      ? { doneVia: r.doneVia as TaskCloseVia }
      : {}),
  };
}

/** Разбор строки app_settings; пусто или кривой JSON — пустой список. */
export function parseTasks(raw: string | null | undefined): ConsultantTask[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(taskFrom).filter((t): t is ConsultantTask => t !== null);
  } catch {
    return [];
  }
}

/** Свежие сверху; при равном времени — по id, чтобы порядок не прыгал. */
export function sortTasks(tasks: ConsultantTask[]): ConsultantTask[] {
  return [...tasks].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

/** Предел списка: сначала уходят старые сделанные, потом — старые открытые. */
export function capTasks(tasks: ConsultantTask[], limit = TASKS_LIMIT): ConsultantTask[] {
  if (tasks.length <= limit) return tasks;
  const oldestFirst = [...tasks].sort((a, b) => a.at.localeCompare(b.at));
  const extra = tasks.length - limit;
  const drop = new Set(
    [...oldestFirst.filter((t) => t.done), ...oldestFirst.filter((t) => !t.done)]
      .slice(0, extra)
      .map((t) => t.id),
  );
  return tasks.filter((t) => !drop.has(t.id));
}

export type NewTask = {
  userKey: string;
  reason: string;
  text: string;
  contact?: string | null;
  channel?: TaskChannel;
  name?: string | null;
  products?: string[];
  link?: string | null;
  /**
   * Входящее, на которое случилась передача (id сообщения канала): повтор
   * того же события задачу не задваивает. Нет — задача всегда новая.
   */
  sourceId?: string | null;
};

/** Id задачи: от входящего — одинаковый при повторе события, иначе — по времени. */
export function taskId(input: Pick<NewTask, "userKey" | "sourceId">, now: Date): string {
  return input.sourceId
    ? `tsk_${sha256Hex(`${input.userKey}\u0000${input.sourceId}`, 24)}`
    : `tsk_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Новая задача из передачи — чистая часть (обрезки, нормализация). */
export function makeTask(input: NewTask, now: Date): ConsultantTask {
  const t = taskFrom({
    id: taskId(input, now),
    at: now.toISOString(),
    userKey: input.userKey,
    reason: input.reason,
    text: input.text,
    contact: input.contact ?? undefined,
    channel: input.channel,
    name: input.name ?? undefined,
    products: input.products,
    link: input.link ?? undefined,
    done: false,
  });
  if (!t) throw serverFailure("задача консультанта: нет покупателя");
  return t;
}

/** Прочитать список. Сбой чтения — ошибка, а не «задач нет». */
export async function loadTasks(ctx: TenantContext): Promise<ConsultantTask[]> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", TASKS_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`задачи консультанта не прочитаны: ${error.message}`);
  return sortTasks(parseTasks(data?.value ?? null));
}

/**
 * Записать задачу о передаче. Задача с тем же id (повтор события) не
 * дописывается второй раз. Сбой записи не мешает ответу покупателю и
 * уведомлению продавца: возвращает null, ошибка — в журнал ошибок
 * (updateSettingStamped сообщает о ней сам).
 */
export async function addTask(
  ctx: TenantContext,
  input: NewTask,
  now = new Date(),
): Promise<ConsultantTask | null> {
  let task: ConsultantTask;
  try {
    task = makeTask(input, now);
  } catch {
    return null;
  }
  const res = await updateSettingStamped(ctx, TASKS_KEY, (raw) => {
    const list = parseTasks(raw);
    if (list.some((t) => t.id === task.id)) return null;
    return JSON.stringify(capTasks([...list, task]));
  }).catch((e: unknown) => {
    console.warn(`[consultant] задача не записалась ${ctx.tenant.id}: ${String(e)}`);
    return "failed" as const;
  });
  return res === "failed" ? null : task;
}

/** Отметить сделанной или вернуть в работу. Нет такой задачи — false. */
export async function setTaskDone(
  ctx: TenantContext,
  id: string,
  done: boolean,
  now = new Date(),
): Promise<boolean> {
  let found = false;
  const res = await updateSettingStamped(ctx, TASKS_KEY, (raw) => {
    const list = parseTasks(raw);
    const cur = list.find((t) => t.id === id);
    found = Boolean(cur);
    if (!cur || cur.done === done) return null;
    return JSON.stringify(
      list.map((t) => {
        if (t.id !== id) return t;
        const { doneAt: _, doneVia: __, ...rest } = t;
        return done
          ? { ...rest, done, doneAt: now.toISOString(), doneVia: "manual" as const }
          : { ...rest, done };
      }),
    );
  });
  if (res === "failed") throw serverFailure("задачи консультанта: отметка не записалась");
  return found;
}

/**
 * Убрать из списка: только сделанные (`done`) или всё (`all`). Список
 * перечитывается внутри условной записи — задача, пришедшая в эту секунду,
 * при «только сделанные» не пропадёт.
 */
export async function clearTasks(
  ctx: TenantContext,
  which: "done" | "all",
): Promise<{ removed: number }> {
  let removed = 0;
  const res = await updateSettingStamped(ctx, TASKS_KEY, (raw) => {
    const list = parseTasks(raw);
    const keep = which === "all" ? [] : list.filter((t) => !t.done);
    removed = list.length - keep.length;
    return removed ? JSON.stringify(keep) : null;
  });
  if (res === "failed") throw serverFailure("задачи консультанта: список не очистился");
  return { removed };
}

/**
 * Менеджер ответил покупателю — свайпом на карточку передачи в Telegram (v1
 * manager-reply.ts), из «Чата» панели или прямо в приложении Instagram/
 * WhatsApp: все его незакрытые задачи, заведённые не позже ответа, сделаны
 * (`repliedAt` — время ответа; задача, пришедшая после него, остаётся).
 * Запись условна по `updated_at` строки (updateSettingStamped): из двух
 * ответов одновременно задачу закрывает один, задача, дописанная в эту
 * секунду, не теряется. Задач нет — ничего не пишем. Сбой записи ответ
 * покупателю не отменяет: false, ошибка — в журнал.
 */
export async function closeTaskAfterReply(
  ctx: TenantContext,
  userKey: string,
  now = new Date(),
  opts: { via?: Exclude<TaskCloseVia, "manual">; repliedAt?: Date } = {},
): Promise<boolean> {
  if (!pricelistMode(ctx.tenant)) return false;
  const cutoff = (opts.repliedAt ?? now).toISOString();
  let closed = false;
  await updateSettingStamped(ctx, TASKS_KEY, (raw) => {
    const list = parseTasks(raw);
    const ids = new Set(
      list.filter((t) => t.userKey === userKey && !t.done && t.at <= cutoff).map((t) => t.id),
    );
    closed = ids.size > 0;
    if (!closed) return null;
    return JSON.stringify(
      list.map((t) =>
        ids.has(t.id)
          ? {
              ...t,
              done: true,
              doneAt: now.toISOString(),
              ...(opts.via ? { doneVia: opts.via } : {}),
            }
          : t,
      ),
    );
  })
    .then((r) => {
      if (r === "failed") closed = false;
    })
    .catch((e: unknown) => {
      console.warn(`[consultant] задача не закрыта ${ctx.tenant.id}: ${String(e)}`);
      closed = false;
    });
  return closed;
}

/** Передача менеджеру, как её отдаёт консультант (core/consultant/engine.server Handoff). */
export type HandoffLike = {
  reason: string;
  summary: string;
  customerName?: string;
  customerContact?: string;
};

/** Ссылка на диалог в Telegram: по нику; без ника ссылки нет. */
export function telegramDialogLink(username: string | null | undefined): string | null {
  const nick = (username ?? "").replace(/^@/, "").trim();
  return /^[A-Za-z0-9_]{4,32}$/.test(nick) ? `https://t.me/${nick}` : null;
}

/**
 * Задача из передачи менеджеру — у консультанта по прайсу (список живёт на
 * его странице «Прайс консультанта»). Имя и контакт — из того, что назвал
 * покупатель, иначе из карточки покупателя.
 */
export async function taskFromHandoff(
  ctx: TenantContext,
  customer: Customer,
  handoff: HandoffLike,
  o: { channel: TaskChannel; products?: string[]; link?: string | null; sourceId?: string | null },
  now = new Date(),
): Promise<ConsultantTask | null> {
  if (!pricelistMode(ctx.tenant)) return null;
  const nick = customer.username ? `@${customer.username.replace(/^@/, "")}` : "";
  return addTask(
    ctx,
    {
      userKey: customer.userKey,
      reason: handoff.reason,
      text: handoff.summary,
      name:
        handoff.customerName?.trim() ||
        [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
        nick ||
        null,
      contact: handoff.customerContact?.trim() || customer.contactPhone || nick || null,
      channel: o.channel,
      products: o.products,
      link: o.link,
      sourceId: o.sourceId,
    },
    now,
  );
}
