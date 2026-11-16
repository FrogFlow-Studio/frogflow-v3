/**
 * Студия 3D-печати: таблица заказов и отметки «один раз» в app_settings
 * (схема базы не меняется). Привязка заказа к клиенту и отметка «написали о
 * готовности» ставятся вставкой новой строки: уникальный ключ (bot_id, key)
 * пускает только первого — он и отправляет сообщение. Повтор события, два
 * крона или двойная доставка вебхука второго сообщения не дают.
 */
import { downloadSheet, type FetchLike } from "@/core/catalog/sheet.server";
import { pageAll } from "@/core/db/page";
import { getSettingsStrict, setSetting } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import {
  BIND_PREFIX,
  parseOrders,
  PRINT3D_AUTO_KEY,
  PRINT3D_READY_KEY,
  PRINT3D_SHEET_KEY,
  READY_PREFIX,
  WAIT_PREFIX,
  WAIT_TTL_MS,
  type Print3dOrder,
} from "./sheet";

const CONTACT_PREFIX = "print3d_contact:";
const GROUP_PREFIX = "print3d_group:";

export type Print3dConfig = { sheetUrl: string; readyNotify: boolean; autoAccept: boolean };

export async function print3dConfig(ctx: TenantContext): Promise<Print3dConfig> {
  const s = await getSettingsStrict(ctx, [PRINT3D_SHEET_KEY, PRINT3D_READY_KEY, PRINT3D_AUTO_KEY]);
  return {
    sheetUrl: (s[PRINT3D_SHEET_KEY] ?? "").trim(),
    readyNotify: s[PRINT3D_READY_KEY] === "true",
    autoAccept: s[PRINT3D_AUTO_KEY] === "true",
  };
}

export type OrdersLoad =
  { ok: true; orders: Print3dOrder[] } | { ok: false; reason: "noSheet" | "noColumns" | string };

/** Заказы из таблицы студии. Таблица закрыта или не скачалась — `ok: false`, не «пусто». */
export async function loadPrint3dOrders(
  ctx: TenantContext,
  fetchImpl?: FetchLike,
  config?: Print3dConfig,
): Promise<OrdersLoad> {
  const { sheetUrl } = config ?? (await print3dConfig(ctx));
  if (!sheetUrl) return { ok: false, reason: "noSheet" };
  const dl = await downloadSheet(sheetUrl, fetchImpl);
  if (!dl.ok) return { ok: false, reason: dl.reason };
  const parsed = parseOrders(dl.csv);
  return parsed.ok ? parsed : { ok: false, reason: "noColumns" };
}

/** Клиент в канале: "telegram:123". WhatsApp через Zernio позже — "whatsapp:<номер>". */
export type ClientAddress = { platform: "telegram"; id: string };

type BindValue = { platform: string; id: string; at: string; automatic?: boolean };

function parseBind(value: string | null | undefined): BindValue | null {
  try {
    const v = JSON.parse(value ?? "") as Partial<BindValue>;
    return typeof v.id === "string" && typeof v.platform === "string"
      ? { platform: v.platform, id: v.id, at: String(v.at ?? ""), automatic: v.automatic === true }
      : null;
  } catch {
    return null;
  }
}

/** Вставить строку один раз: true — вставили мы, false — ключ уже был. */
async function insertOnce(ctx: TenantContext, key: string, value: string): Promise<boolean> {
  const { error } = await ctx.db
    .from("app_settings")
    .insert({ bot_id: ctx.tenant.id, key, value, updated_at: new Date().toISOString() });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  throw serverFailure(`Отметка ${key}: ${error.message}`);
}

export type BindResult =
  { kind: "bound" } | { kind: "same" } | { kind: "taken"; other: BindValue | null };

/**
 * Привязать заказ к клиенту. Первый, кто прислал номер, получает карточку
 * (`bound`); тот же клиент повторно — `same` (карточку второй раз не шлём);
 * другой чат — `taken`.
 */
export async function bindOrder(
  ctx: TenantContext,
  orderNo: string,
  client: ClientAddress,
  now = new Date(),
  automatic = false,
): Promise<BindResult> {
  const value = JSON.stringify({ ...client, at: now.toISOString(), automatic });
  if (await insertOnce(ctx, BIND_PREFIX + orderNo, value)) return { kind: "bound" };
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", BIND_PREFIX + orderNo)
    .maybeSingle();
  if (error) throw serverFailure(`Привязка заказа ${orderNo}: ${error.message}`);
  const other = parseBind(data?.value);
  if (other && other.platform === client.platform && other.id === client.id)
    return { kind: "same" };
  return { kind: "taken", other };
}

/** Сюда попадает только свой контакт, которым клиент поделился в Telegram. */
export function saveOrderContact(ctx: TenantContext, clientId: string, phone: string) {
  return setSetting(ctx, CONTACT_PREFIX + clientId, phone);
}

async function listOrderSettings(ctx: TenantContext, prefix: string) {
  return pageAll<{ key: string; value: string | null }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .eq("bot_id", ctx.tenant.id)
        .like("key", `${prefix}%`)
        .order("key")
        .range(from, to),
    "Настройки заказов студии",
  );
}

/** Телефон → чат. Если номер поделили два чата, адрес неоднозначен. */
export async function listOrderContacts(ctx: TenantContext): Promise<Map<string, string | null>> {
  const byPhone = new Map<string, string | null>();
  for (const { key, value } of await listOrderSettings(ctx, CONTACT_PREFIX)) {
    const id = key.slice(CONTACT_PREFIX.length);
    if (value && /^\d+$/.test(id)) byPhone.set(value, byPhone.has(value) ? null : id);
  }
  return byPhone;
}

export async function listGroupClaims(ctx: TenantContext): Promise<Set<string>> {
  return new Set((await listOrderSettings(ctx, GROUP_PREFIX)).map(({ key }) => key));
}

export function groupClaimKey(orderNo: string, chatId: string): string {
  return `${GROUP_PREFIX}${chatId}:${orderNo}`;
}

export function claimGroupCard(ctx: TenantContext, orderNo: string, chatId: string, now: Date) {
  return insertOnce(ctx, groupClaimKey(orderNo, chatId), now.toISOString());
}

/** Все привязки магазина: номер заказа → клиент. Постранично, без обрезки. */
export async function listBindings(ctx: TenantContext): Promise<Map<string, BindValue>> {
  const rows = await pageAll<{ key: string; value: string | null }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${BIND_PREFIX}%`)
        .order("key")
        .range(from, to),
    "Привязки заказов студии",
  );
  const out = new Map<string, BindValue>();
  for (const r of rows) {
    const v = parseBind(r.value);
    if (v) out.set(r.key.slice(BIND_PREFIX.length), v);
  }
  return out;
}

/** Номера заказов, о готовности которых уже написали (или пытались). */
export async function listReadySent(ctx: TenantContext): Promise<Set<string>> {
  const rows = await pageAll<{ key: string }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key")
        .like("key", `${READY_PREFIX}%`)
        .order("key")
        .range(from, to),
    "Отметки готовности студии",
  );
  return new Set(rows.map((r) => r.key.slice(READY_PREFIX.length)));
}

/** Отметка «о готовности написали» — до отправки; пишет только выигравший. */
export function claimReady(ctx: TenantContext, orderNo: string, now = new Date()) {
  return insertOnce(ctx, READY_PREFIX + orderNo, now.toISOString());
}

/** Номер заказа, к которому привязан клиент (последний по времени), или null. */
export function orderOfClient(
  bindings: Map<string, BindValue>,
  client: ClientAddress,
): string | null {
  let best: { no: string; at: string } | null = null;
  for (const [no, v] of bindings) {
    if (v.platform !== client.platform || v.id !== client.id) continue;
    if (!best || v.at > best.at) best = { no, at: v.at };
  }
  return best?.no ?? null;
}

/**
 * Клиент ждёт номер, которого ещё нет в таблице. Первый, кто прислал номер,
 * его и ждёт; true — ожидание записано этим вызовом.
 */
export function addWait(
  ctx: TenantContext,
  orderNo: string,
  client: ClientAddress,
  now = new Date(),
): Promise<boolean> {
  const value = JSON.stringify({ platform: client.platform, id: client.id, at: now.toISOString() });
  return insertOnce(ctx, WAIT_PREFIX + orderNo, value);
}

export type Wait = { no: string; client: BindValue };

/** Все ожидания магазина. Постранично, без обрезки. */
export async function listWaits(ctx: TenantContext): Promise<Wait[]> {
  const rows = await pageAll<{ key: string; value: string | null }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${WAIT_PREFIX}%`)
        .order("key")
        .range(from, to),
    "Ожидания заказов студии",
  );
  const out: Wait[] = [];
  for (const r of rows) {
    const v = parseBind(r.value);
    if (v) out.push({ no: r.key.slice(WAIT_PREFIX.length), client: v });
  }
  return out;
}

/** Снять ожидание (номер появился или срок вышел). */
export async function dropWait(ctx: TenantContext, orderNo: string): Promise<void> {
  const { error } = await ctx.db
    .from("app_settings")
    .delete()
    .eq("key", WAIT_PREFIX + orderNo);
  if (error) throw serverFailure(`Ожидание заказа ${orderNo}: ${error.message}`);
}

export function waitExpired(w: Wait, now = new Date()): boolean {
  const at = Date.parse(w.client.at);
  return !Number.isFinite(at) || now.getTime() - at > WAIT_TTL_MS;
}
