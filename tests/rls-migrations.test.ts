import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Права ключа арендатора (`tenant_bot`) по миграциям 19-*.sql. Базы тут нет:
 * тест читает сами файлы и проверяет, что для каждой таблицы по каждой
 * команде (select / insert / update / delete) ключ арендатора
 *   - не читает чужие строки и не пишет в чужие;
 *   - не пишет поля платформы (`author`, `notified_at`, `read_at`, статусы,
 *     метки, сроки): вставка закрыта условием, обновление — списком колонок;
 *   - не получает права без политики, а политика `FOR ALL` без условия падает.
 * Таблицы, где у ключа арендатора нет ничего (`marketplace_buyers`,
 * `marketplace_buyer_links`, общие таблицы сообщества), остаются без политик
 * и без прав: ходит туда только service_role.
 */

type Cmd = "select" | "insert" | "update" | "delete";
const CMDS: Cmd[] = ["select", "insert", "update", "delete"];

interface Policy {
  name: string;
  table: string;
  cmd: Cmd | "all";
  roles: string[];
  using: string | null;
  check: string | null;
}
interface Grant {
  table: string;
  role: string;
  cmd: Cmd;
  /** Колонки для UPDATE (INSERT/SELECT по колонкам у нас нет); null — вся таблица. */
  cols: string[] | null;
}
interface Model {
  tables: Map<string, string[]>;
  rls: Set<string>;
  policies: Policy[];
  grants: Grant[];
  triggers: Set<string>;
  revoked: Set<string>;
}

const bare = (s: string) => s.replace(/^public\./, "").replace(/"/g, "");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function statements(sql: string): string[] {
  // Тела функций ($$…$$) содержат «;» — прячем, чтобы не резать на куски.
  const noComments = sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
  const noBodies = noComments.replace(/\$\$[\s\S]*?\$\$/g, "$$BODY$$");
  return noBodies
    .split(";")
    .map(norm)
    .filter((x) => x.length > 0);
}

/** Скобка, закрывающая ту, что открыта в позиции `open`. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return s.length;
}

export function parseMigration(sql: string): Model {
  const m: Model = {
    tables: new Map(),
    rls: new Set(),
    policies: [],
    grants: [],
    triggers: new Set(),
    revoked: new Set(),
  };
  for (const st of statements(sql)) {
    let r: RegExpMatchArray | null;
    if ((r = st.match(/^create table (?:if not exists )?([\w.]+) \(/i))) {
      const open = st.indexOf("(");
      const body = st.slice(open + 1, closing(st, open));
      const cols: string[] = [];
      let depth = 0;
      let cur = "";
      for (const ch of body + ",") {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          const w = cur.trim().split(/\s+/)[0]!.toLowerCase();
          if (w && !["primary", "unique", "check", "constraint", "foreign"].includes(w))
            cols.push(w);
          cur = "";
        } else cur += ch;
      }
      m.tables.set(bare(r[1]!), cols);
    } else if ((r = st.match(/^alter table ([\w.]+) enable row level security$/i))) {
      m.rls.add(bare(r[1]!));
    } else if ((r = st.match(/^create policy (\w+) on ([\w.]+) (.*)$/i))) {
      const rest = r[3]!;
      const cmd = (
        rest.match(/\bfor (all|select|insert|update|delete)\b/i)?.[1] ?? "all"
      ).toLowerCase();
      const to = rest.match(/\bto ([\w, ]+?)(?= using| with check|$)/i)?.[1] ?? "public";
      const u = rest.search(/\busing \(/i);
      const c = rest.search(/\bwith check \(/i);
      const grab = (at: number) =>
        at < 0 ? null : rest.slice(rest.indexOf("(", at) + 1, closing(rest, rest.indexOf("(", at)));
      m.policies.push({
        name: r[1]!,
        table: bare(r[2]!),
        cmd: cmd as Policy["cmd"],
        roles: to.split(",").map((x) => x.trim().toLowerCase()),
        using: grab(u),
        check: grab(c),
      });
    } else if ((r = st.match(/^revoke all on (?:table )?([\w., ]+) from ([\w., ]+)$/i))) {
      for (const t of r[1]!.split(","))
        for (const role of r[2]!.split(","))
          m.revoked.add(`${bare(t.trim())}:${role.trim().toLowerCase()}`);
    } else if ((r = st.match(/^grant (.+?) on (?:table )?([\w., ]+) to ([\w., ]+)$/i))) {
      const privs = r[1]!;
      const colUpdate = privs.match(/^update \(([^)]*)\)$/i);
      const list = colUpdate ? ["update"] : privs.split(",").map((x) => x.trim().toLowerCase());
      const expanded =
        list.includes("all") || list.includes("all privileges") ? [...CMDS, "all"] : list;
      for (const t of r[2]!.split(","))
        for (const role of r[3]!.split(","))
          for (const p of expanded)
            m.grants.push({
              table: bare(t.trim()),
              role: role.trim().toLowerCase(),
              cmd: p as Cmd,
              cols: colUpdate ? colUpdate[1]!.split(",").map((x) => x.trim().toLowerCase()) : null,
            });
    } else if (
      (r = st.match(/^create trigger (\w+) before (?:insert|update)(?: of [\w, ]+)? on ([\w.]+)/i))
    ) {
      m.triggers.add(`${bare(r[2]!)}:${r[1]}`);
    }
  }
  return m;
}

const TENANT = "tenant_bot";
/** Поля, которые пишет только платформа (оператор через service_role). */
const PLATFORM_COLS = [
  "author",
  "notified_at",
  "read_at",
  "status",
  "labels",
  "due_at",
  "first_response_at",
  "last_operator_message_at",
  "hidden",
  "hidden_by",
  "hidden_at",
  "published_at",
  "archived",
  "rating",
  "rating_count",
  "orders_month",
];
/** Поля, которые по смыслу пишет сам арендатор: его собственная отметка. */
const OWN_FIELDS = new Set(["platform_news_reads.read_at"]);
/** Условие привязано к своему магазину. */
const OWN = /\bcurrent_bot_id\(\)/i;

/**
 * Исключения из «поле платформы не пишется ключом арендатора» — каждое с причиной.
 * Ключ: `таблица.колонка`.
 */
const ALLOWED_TENANT_WRITES: Record<string, string> = {
  // Отметка «прочитано» ответов оператора; политика ограничена author = 'operator'.
  "platform_messages.read_at": "продавец отмечает ответы оператора прочитанными",
  // Один переход waiting_seller → in_progress, остальное режет триггер trg_seller_status.
  "platform_threads.status": "продавец отвечает на вопрос оператора",
};

/** Проверка одной миграции; возвращает список нарушений (пусто — всё хорошо). */
export function checkMigration(sql: string): string[] {
  const m = parseMigration(sql);
  const bad: string[] = [];
  for (const [table, cols] of m.tables) {
    if (!m.rls.has(table)) bad.push(`${table}: не включён row level security`);
    const grants = m.grants.filter((g) => g.table === table);
    for (const g of grants)
      if (["anon", "authenticated", "public"].includes(g.role))
        bad.push(`${table}: права для ${g.role} — публичного доступа к таблице быть не должно`);
    const mine = grants.filter((g) => g.role === TENANT);
    if (mine.some((g) => (g.cmd as string) === "all"))
      bad.push(`${table}: GRANT ALL ключу арендатора — права выдаются по командам`);
    const policies = m.policies.filter((p) => p.table === table);
    const forTenant = policies.filter(
      (p) => p.roles.includes(TENANT) || p.roles.includes("public"),
    );
    if (mine.length === 0) {
      // Ничего не выдано → политик для арендатора быть не должно: мёртвая политика
      // однажды оживёт вместе с случайным GRANT.
      if (forTenant.length > 0)
        bad.push(`${table}: нет прав у ${TENANT}, но есть политики для него`);
      if (
        !m.revoked.has(`${table}:${TENANT}`) &&
        !m.revoked.has(`${table}:anon`) &&
        grants.length === 0
      )
        bad.push(`${table}: не снят доступ ключа арендатора (REVOKE ALL … FROM ${TENANT})`);
      continue;
    }
    if (!m.revoked.has(`${table}:${TENANT}`))
      bad.push(`${table}: перед выдачей прав не снят доступ (REVOKE ALL … FROM ${TENANT})`);
    for (const p of forTenant) {
      if (p.cmd === "all" && (!p.using || !p.check))
        bad.push(`${table}.${p.name}: FOR ALL без USING и WITH CHECK`);
    }
    for (const cmd of CMDS) {
      const granted = mine.filter((g) => g.cmd === cmd);
      const covering = forTenant.filter((p) => p.cmd === cmd || p.cmd === "all");
      if (granted.length === 0) {
        if (covering.some((p) => p.cmd === cmd))
          bad.push(`${table}: политика на ${cmd} без права ${cmd}`);
        continue;
      }
      if (covering.length === 0) {
        bad.push(`${table}: есть право ${cmd}, но нет политики`);
        continue;
      }
      for (const p of covering) {
        const own = (c: string | null) => c !== null && OWN.test(c);
        if (cmd === "select" && !own(p.using) && !PUBLIC_READ[table]?.test(p.using ?? ""))
          bad.push(`${table}.${p.name}: чтение не ограничено своим магазином`);
        if (cmd === "insert" && !own(p.check))
          bad.push(`${table}.${p.name}: вставка без привязки к своему магазину`);
        if (cmd === "update" && (!own(p.using) || !own(p.check)))
          bad.push(`${table}.${p.name}: обновление без привязки к своему магазину`);
        if (cmd === "delete" && !own(p.using)) bad.push(`${table}.${p.name}: удаление чужих строк`);
      }
      // Поля платформы.
      const touches = PLATFORM_COLS.filter(
        (c) => cols.includes(c) && !OWN_FIELDS.has(`${table}.${c}`),
      );
      if (cmd === "update") {
        for (const g of granted) {
          if (g.cols === null) {
            if (touches.length > 0)
              bad.push(
                `${table}: UPDATE на всю таблицу, а в ней поля платформы: ${touches.join(", ")}`,
              );
            continue;
          }
          for (const c of g.cols)
            if (PLATFORM_COLS.includes(c) && !ALLOWED_TENANT_WRITES[`${table}.${c}`])
              bad.push(`${table}: ключ арендатора обновляет поле платформы ${c}`);
        }
        // Разрешённое исключение держится на защите: триггер или условие политики.
        for (const g of granted)
          for (const c of g.cols ?? []) {
            if (
              c === "status" &&
              ALLOWED_TENANT_WRITES[`${table}.status`] &&
              !m.triggers.has(`${table}:trg_seller_status`)
            )
              bad.push(`${table}: статус обновляется без триггера trg_seller_status`);
            if (
              c === "read_at" &&
              !covering.every((p) => /author\s*=\s*'operator'/i.test(p.using ?? ""))
            )
              bad.push(`${table}: read_at обновляется не только у ответов оператора`);
          }
      }
      if (cmd === "insert" && touches.length > 0) {
        // Что платформа заполняет сама, вставка должна задавать пустым или единственным значением.
        const need = INSERT_PINS[table] ?? [];
        for (const p of covering)
          for (const pin of need)
            if (!pin.test(p.check ?? ""))
              bad.push(`${table}.${p.name}: вставка не закрепляет поле платформы (${pin})`);
        if (!INSERT_PINS[table])
          bad.push(
            `${table}: вставка ключом арендатора при полях платформы (${touches.join(", ")}) без описанных условий в тесте`,
          );
      }
    }
  }
  return bad;
}

/** Таблицы, которые арендатор читает не только по своему bot_id: условие публичности. */
const PUBLIC_READ: Record<string, RegExp> = {
  // Новости платформы: только опубликованные и не в архиве.
  platform_news: /published_at IS NOT NULL.*published_at <= now\(\).*NOT archived/i,
};

/** Что обязана закреплять политика INSERT, если в таблице есть поля платформы. */
const INSERT_PINS: Record<string, RegExp[]> = {
  platform_messages: [/author\s*=\s*'seller'/i, /notified_at IS NULL/i, /read_at IS NULL/i],
  platform_threads: [
    /status\s*=\s*'new'/i,
    /labels\s*=\s*'\{\}'/i,
    /first_response_at IS NULL/i,
    /due_at IS NULL/i,
    /last_operator_message_at IS NULL/i,
  ],
};

const dir = join(process.cwd(), "migrations");
const files = readdirSync(dir)
  .filter((f) => /^19-\d+-.+\.sql$/.test(f) && !f.endsWith(".down.sql"))
  .sort();

describe("права ключа арендатора по миграциям 19-*", () => {
  it("миграции найдены", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const f of files)
    it(`${f}: ни чужих строк, ни полей платформы`, () => {
      expect(checkMigration(readFileSync(join(dir, f), "utf8"))).toEqual([]);
    });

  it("маркетплейс-покупатели и связи остаются без политик и без прав арендатора", () => {
    const m = parseMigration(readFileSync(join(dir, "19-17-marketplace-buyers.sql"), "utf8"));
    for (const t of ["marketplace_buyers", "marketplace_buyer_links"]) {
      expect(m.tables.has(t), t).toBe(true);
      expect(m.rls.has(t), t).toBe(true);
      expect(
        m.policies.filter((p) => p.table === t),
        t,
      ).toEqual([]);
      expect(
        m.grants.filter((g) => g.table === t),
        t,
      ).toEqual([]);
      expect(m.revoked.has(`${t}:${TENANT}`), t).toBe(true);
    }
  });

  it("поддержка: по командам — что продавец может и чего нет", () => {
    const m = parseMigration(readFileSync(join(dir, "19-1-platform-support.sql"), "utf8"));
    const can = (table: string, cmd: Cmd) =>
      m.grants.some((g) => g.table === table && g.role === TENANT && g.cmd === cmd);
    for (const t of ["platform_threads", "platform_messages"]) {
      expect(can(t, "select"), `${t} select`).toBe(true);
      expect(can(t, "insert"), `${t} insert`).toBe(true);
      expect(can(t, "delete"), `${t} delete`).toBe(false);
    }
    // Заметки оператора ключу арендатора не видны совсем.
    for (const c of CMDS) expect(can("platform_thread_notes", c), `notes ${c}`).toBe(false);
    // Колонки обновления сообщений — только read_at, обращений — без меток и сроков.
    const upd = (t: string) =>
      m.grants.filter((g) => g.table === t && g.role === TENANT && g.cmd === "update");
    expect(upd("platform_messages").flatMap((g) => g.cols)).toEqual(["read_at"]);
    const threadCols = upd("platform_threads").flatMap((g) => g.cols ?? []);
    for (const c of ["labels", "due_at", "first_response_at", "last_operator_message_at", "bot_id"])
      expect(threadCols, c).not.toContain(c);
  });

  it("таблицы сообщества, совместных акций и аналитики закрыты для ключа арендатора", () => {
    for (const f of [
      "19-2-community-threads.sql",
      "19-3-community-dm.sql",
      "19-4-joint-promos.sql",
      "19-20-market-analytics.sql",
    ]) {
      const m = parseMigration(readFileSync(join(dir, f), "utf8"));
      expect(
        m.grants.filter((g) => g.role === TENANT),
        f,
      ).toEqual([]);
      expect(
        m.policies.filter((p) => p.roles.includes(TENANT)),
        f,
      ).toEqual([]);
    }
  });

  describe("проверка ловит поломки (на заведомо плохих миграциях)", () => {
    const base = (extra: string) => `
      CREATE TABLE t (id uuid PRIMARY KEY, bot_id uuid NOT NULL, author text, read_at timestamptz, status text);
      ALTER TABLE t ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON t FROM tenant_bot;
      ${extra}`;
    it("FOR ALL без условия", () => {
      const bad = checkMigration(
        base(`GRANT SELECT ON t TO tenant_bot;
              CREATE POLICY p ON t FOR ALL TO tenant_bot USING (true);`),
      );
      expect(bad.join("\n")).toMatch(/FOR ALL без USING и WITH CHECK/);
    });
    it("чтение без привязки к своему магазину", () => {
      const bad = checkMigration(
        base(`GRANT SELECT ON t TO tenant_bot;
              CREATE POLICY p ON t FOR SELECT TO tenant_bot USING (true);`),
      );
      expect(bad.join("\n")).toMatch(/чтение не ограничено/);
    });
    it("UPDATE на всю таблицу с полями платформы", () => {
      const bad = checkMigration(
        base(`GRANT SELECT, UPDATE ON t TO tenant_bot;
              CREATE POLICY a ON t FOR SELECT TO tenant_bot USING (bot_id = current_bot_id());
              CREATE POLICY b ON t FOR UPDATE TO tenant_bot
                USING (bot_id = current_bot_id()) WITH CHECK (bot_id = current_bot_id());`),
      );
      expect(bad.join("\n")).toMatch(/UPDATE на всю таблицу/);
    });
    it("колонка платформы в списке обновления", () => {
      const bad = checkMigration(
        base(`GRANT SELECT ON t TO tenant_bot;
              GRANT UPDATE (author) ON t TO tenant_bot;
              CREATE POLICY a ON t FOR SELECT TO tenant_bot USING (bot_id = current_bot_id());
              CREATE POLICY b ON t FOR UPDATE TO tenant_bot
                USING (bot_id = current_bot_id()) WITH CHECK (bot_id = current_bot_id());`),
      );
      expect(bad.join("\n")).toMatch(/поле платформы author/);
    });
    it("право без политики и политика без права", () => {
      expect(checkMigration(base(`GRANT INSERT ON t TO tenant_bot;`)).join("\n")).toMatch(
        /право insert, но нет политики/,
      );
      expect(
        checkMigration(
          base(`CREATE POLICY a ON t FOR SELECT TO tenant_bot USING (bot_id = current_bot_id());`),
        ).join("\n"),
      ).toMatch(/нет прав у tenant_bot, но есть политики/);
    });
    it("доступ для anon и таблица без RLS", () => {
      expect(checkMigration(base(`GRANT SELECT ON t TO anon;`)).join("\n")).toMatch(
        /публичного доступа/,
      );
      expect(
        checkMigration(`CREATE TABLE t2 (id uuid); REVOKE ALL ON t2 FROM tenant_bot;`).join("\n"),
      ).toMatch(/не включён row level security/);
    });
    it("вставка без закрепления полей платформы", () => {
      const bad = checkMigration(`
        CREATE TABLE platform_messages (id uuid, bot_id uuid, author text, read_at timestamptz, notified_at timestamptz);
        ALTER TABLE platform_messages ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON platform_messages FROM tenant_bot;
        GRANT INSERT ON platform_messages TO tenant_bot;
        CREATE POLICY i ON platform_messages FOR INSERT TO tenant_bot WITH CHECK (bot_id = current_bot_id());`);
      expect(bad.join("\n")).toMatch(/не закрепляет поле платформы/);
    });
  });
});
