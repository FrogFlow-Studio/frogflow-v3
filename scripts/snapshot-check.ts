/**
 * Сверка копии базы (восстановленной из бэкапа) с боевой — ТОЛЬКО НА ЧТЕНИЕ.
 * Порядок работы — docs/BACKUP.md.
 *
 *   node scripts/snapshot-check.ts --env копия.env --out копия.json
 *       снять счётчики строк и последнюю дату заказа с копии (или с боевой);
 *   node scripts/snapshot-check.ts --env копия.env --ref боевая.json
 *       снять с копии и сравнить с ранее снятым файлом боевой.
 *
 * `--env` — файл вида KEY=value с SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY
 * ТОЙ базы, что проверяем: ключи не в командной строке и не в окружении
 * процесса. Скрипт шлёт только GET: ни одной записи, ни одного DDL.
 * Код возврата 1 — копия не годится (нет таблицы или бакета, строк больше,
 * чем в боевой); меньше строк — норма, копия старше боевой, это печатается.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** Таблицы public (docs/db-schema.md, раздел 0). */
export const TABLES = [
  "bots",
  "bot_events",
  "bot_health_snapshots",
  "module_requests",
  "admin_login_attempts",
  "operator_login_attempts",
  "operator_broadcasts",
  "operator_settings",
  "subscription_payments",
  "subscription_invoices",
  "app_settings",
  "categories",
  "products",
  "product_images",
  "product_variants",
  "product_material_files",
  "product_reviews",
  "orders",
  "order_items",
  "order_counters",
  "cart_items",
  "web_cart_handoffs",
  "delivery_zones",
  "promo_codes",
  "gift_certificates",
  "referrals",
  "bot_users",
  "blocked_users",
  "manager_chat_state",
  "manager_chat_messages",
  "payment_methods",
  "vip_tariffs",
  "vip_subscriptions",
  "vip_member_profiles",
  "broadcasts",
  "broadcast_recipients",
  "whatsapp_templates",
  "consultant_message_runs",
  "consultant_handoffs",
  "consultant_catalog_imports",
  "story_product_tags",
  "zernio_logs",
  "comment_dm_fallback_sends",
  "comment_automation_settings",
  "sales_leads",
  "sales_lead_events",
] as const;

/** Бакеты Storage (docs/db-schema.md, раздел 3). Файлы в бэкап базы не входят. */
export const BUCKETS = [
  "product-files",
  "product-images",
  "payment-proofs",
  "broadcast-images",
  "legal-docs",
  "instruction-videos",
  "instagram-media",
] as const;

export type Snapshot = {
  takenAt: string;
  host: string;
  /** null — таблицы нет или она не читается. */
  counts: Record<string, number | null>;
  lastOrderAt: string | null;
  buckets: string[];
};

export type Comparison = {
  /** Нет в копии или не читается. */
  missing: string[];
  /** В копии строк больше, чем в боевой: копия не из этой базы или боевую чистили. */
  extra: Array<{ table: string; copy: number; ref: number }>;
  /** В копии строк меньше: копия старше боевой (ожидаемо). */
  behind: Array<{ table: string; copy: number; ref: number }>;
  missingBuckets: string[];
  ok: boolean;
};

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

export function compareSnapshots(copy: Snapshot, ref: Snapshot | null): Comparison {
  const missing = TABLES.filter((t) => copy.counts[t] == null);
  const missingBuckets = BUCKETS.filter((b) => !copy.buckets.includes(b));
  const extra: Comparison["extra"] = [];
  const behind: Comparison["behind"] = [];
  if (ref) {
    for (const table of TABLES) {
      const c = copy.counts[table];
      const r = ref.counts[table];
      if (c == null || r == null) continue;
      if (c > r) extra.push({ table, copy: c, ref: r });
      else if (c < r) behind.push({ table, copy: c, ref: r });
    }
  }
  return {
    missing,
    extra,
    behind,
    missingBuckets,
    ok: missing.length === 0 && extra.length === 0 && missingBuckets.length === 0,
  };
}

export function report(copy: Snapshot, ref: Snapshot | null, cmp: Comparison): string {
  const lines = [`Копия ${copy.host}, снято ${copy.takenAt}.`];
  lines.push(`Последний заказ в копии: ${copy.lastOrderAt ?? "заказов нет"}.`);
  if (ref)
    lines.push(
      `Боевая ${ref.host}, снято ${ref.takenAt}; последний заказ: ${ref.lastOrderAt ?? "—"}.`,
    );
  lines.push(
    cmp.missing.length
      ? `❌ Нет таблиц или не читаются: ${cmp.missing.join(", ")}.`
      : `✅ Все ${TABLES.length} таблиц читаются.`,
  );
  lines.push(
    cmp.missingBuckets.length
      ? `❌ Нет бакетов Storage: ${cmp.missingBuckets.join(", ")}. Файлы из бэкапа базы не восстанавливаются, их переносят отдельно (docs/BACKUP.md).`
      : `✅ Все ${BUCKETS.length} бакетов на месте (содержимое сверяйте отдельно).`,
  );
  if (ref) {
    for (const e of cmp.extra)
      lines.push(`❌ ${e.table}: в копии ${e.copy}, в боевой ${e.ref} — копия не из этой базы?`);
    for (const b of cmp.behind)
      lines.push(
        `ℹ️ ${b.table}: в копии ${b.copy}, в боевой ${b.ref} (копия старше на ${b.ref - b.copy}).`,
      );
    if (cmp.extra.length === 0 && cmp.behind.length === 0) lines.push("✅ Счётчики совпали.");
  }
  lines.push(cmp.ok ? "Итог: копия годится." : "Итог: копия НЕ годится.");
  return lines.join("\n");
}

const TIMEOUT_MS = 20_000;

async function get(
  url: string,
  key: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  // Только GET: сверка ничего не пишет.
  return fetch(url, {
    method: "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...extra },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function countRows(base: string, key: string, table: string): Promise<number | null> {
  const res = await get(`${base}/rest/v1/${table}?select=*&limit=1`, key, {
    Prefer: "count=exact",
    Range: "0-0",
  });
  if (!res.ok) return null;
  const total = res.headers.get("content-range")?.split("/")[1];
  const n = Number(total);
  return total && Number.isFinite(n) ? n : null;
}

export async function takeSnapshot(base: string, key: string): Promise<Snapshot> {
  const counts: Record<string, number | null> = {};
  for (const table of TABLES) counts[table] = await countRows(base, key, table);
  const last = await get(
    `${base}/rest/v1/orders?select=created_at&order=created_at.desc&limit=1`,
    key,
  );
  const lastRows = last.ok ? ((await last.json()) as Array<{ created_at: string }>) : [];
  const bucketRes = await get(`${base}/storage/v1/bucket`, key);
  const buckets = bucketRes.ok
    ? ((await bucketRes.json()) as Array<{ name: string }>).map((b) => b.name)
    : [];
  return {
    takenAt: new Date().toISOString(),
    host: new URL(base).host,
    counts,
    lastOrderAt: lastRows[0]?.created_at ?? null,
    buckets,
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const envPath = arg("--env");
  if (!envPath) {
    console.error("Нужен --env <файл с SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY проверяемой базы>");
    return 2;
  }
  const e = parseEnvFile(readFileSync(envPath, "utf8"));
  const url = e.SUPABASE_URL?.replace(/\/$/, "");
  const key = e.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("В файле нет SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY");
    return 2;
  }
  const copy = await takeSnapshot(url, key);
  const out = arg("--out");
  if (out) writeFileSync(out, `${JSON.stringify(copy, null, 2)}\n`);
  const refPath = arg("--ref");
  const ref = refPath ? (JSON.parse(readFileSync(refPath, "utf8")) as Snapshot) : null;
  const cmp = compareSnapshots(copy, ref);
  console.log(report(copy, ref, cmp));
  return cmp.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
