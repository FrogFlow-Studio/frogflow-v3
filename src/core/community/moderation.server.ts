import { serviceDb } from "@/core/db/client.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { CommunityNotReady, isMissingTable } from "./not-ready";
import { recount } from "./threads.server";

/** Жалобы сообщества для оператора и скрытие записей (С2). Только service_role, без ctx арендатора. */
type DbErr = { code?: string | undefined; message: string } | null;
function check(what: string, error: DbErr): void {
  if (!error) return;
  if (isMissingTable(error)) throw new CommunityNotReady();
  throw serverFailure(`модерация сообщества, ${what}: ${error.message}`);
}

export type ReportItem = {
  id: string;
  kind: "thread" | "post";
  threadId: string;
  postId: string | null;
  reporter: string;
  author: string;
  title: string;
  text: string;
  reason: string | null;
  createdAt: string;
  /** Уже скрыто (оператором или по жалобам): остаётся только закрыть жалобу. */
  hidden: boolean;
};

const REPORT_PAGE = 20;

/** Открытые жалобы, старые первыми; страница по смещению, `total` — сколько всего открыто. */
export async function listOpenReports(
  offset = 0,
): Promise<{ reports: ReportItem[]; total: number; next: number | null }> {
  const from = Math.max(0, Math.floor(offset));
  const { data, error, count } = await serviceDb()
    .from("community_reports")
    .select("id, bot_id, thread_id, post_id, reason, created_at", { count: "exact" })
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + REPORT_PAGE - 1);
  check("жалобы не прочитаны", error);
  const rows = data ?? [];
  const names = new Map((await tenantDirectory()).map((t) => [t.id, t.name]));
  const threadIds = [...new Set(rows.map((r) => r.thread_id))];
  const postIds = rows.map((r) => r.post_id).filter((x): x is string => !!x);
  const threads = new Map<
    string,
    { bot_id: string; title: string; body: string; hidden: boolean }
  >();
  const posts = new Map<string, { bot_id: string; body: string; hidden: boolean }>();
  for (let i = 0; i < threadIds.length; i += 200) {
    const { data: t, error: te } = await serviceDb()
      .from("community_threads")
      .select("id, bot_id, title, body, hidden")
      .in("id", threadIds.slice(i, i + 200));
    check("темы жалоб не прочитаны", te);
    for (const x of t ?? []) threads.set(x.id, x);
  }
  for (let i = 0; i < postIds.length; i += 200) {
    const { data: p, error: pe } = await serviceDb()
      .from("community_posts")
      .select("id, bot_id, body, hidden")
      .in("id", postIds.slice(i, i + 200));
    check("ответы жалоб не прочитаны", pe);
    for (const x of p ?? []) posts.set(x.id, x);
  }
  const reports: ReportItem[] = rows.map((r) => {
    const t = threads.get(r.thread_id);
    const p = r.post_id ? posts.get(r.post_id) : undefined;
    const ownerId = p?.bot_id ?? t?.bot_id ?? "";
    return {
      id: r.id,
      kind: r.post_id ? "post" : "thread",
      threadId: r.thread_id,
      postId: r.post_id,
      reporter: names.get(r.bot_id) ?? "—",
      author: names.get(ownerId) ?? "—",
      title: t?.title ?? "",
      text: (p?.body ?? t?.body ?? "").slice(0, 600),
      reason: r.reason,
      createdAt: r.created_at,
      hidden: Boolean(p ? p.hidden : t?.hidden),
    };
  });
  const total = count ?? from + rows.length;
  return { reports, total, next: from + REPORT_PAGE < total ? from + REPORT_PAGE : null };
}

/**
 * Решение по жалобе. `hide` скрывает запись (тему или ответ) и закрывает все открытые жалобы на
 * неё; `dismiss` закрывает только эту жалобу. Скрытие условно (`hidden = false`), повтор безвреден.
 */
export async function resolveReport(reportId: string, action: "hide" | "dismiss"): Promise<void> {
  const { data: r, error } = await serviceDb()
    .from("community_reports")
    .select("id, thread_id, post_id, status")
    .eq("id", reportId)
    .maybeSingle();
  check("жалоба не прочитана", error);
  if (!r) return;
  const now = new Date().toISOString();
  if (action === "hide") {
    if (r.post_id) {
      const { error: e1 } = await serviceDb()
        .from("community_posts")
        .update({ hidden: true, hidden_by: "operator", hidden_at: now })
        .eq("id", r.post_id)
        .eq("hidden", false);
      check("ответ не скрыт", e1);
      await recount(r.thread_id, false);
    } else {
      const { error: e2 } = await serviceDb()
        .from("community_threads")
        .update({ hidden: true, hidden_by: "operator", hidden_at: now })
        .eq("id", r.thread_id)
        .eq("hidden", false);
      check("тема не скрыта", e2);
    }
    let q = serviceDb()
      .from("community_reports")
      .update({ status: "done" })
      .eq("thread_id", r.thread_id)
      .eq("status", "open");
    q = r.post_id ? q.eq("post_id", r.post_id) : q.is("post_id", null);
    const { error: e3 } = await q;
    check("жалобы не закрыты", e3);
    return;
  }
  const { error: e4 } = await serviceDb()
    .from("community_reports")
    .update({ status: "done" })
    .eq("id", reportId)
    .eq("status", "open");
  check("жалоба не закрыта", e4);
}
