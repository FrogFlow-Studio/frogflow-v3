import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import {
  pruneAdminLoginAttempts,
  pruneBotEvents,
  pruneManagerChatMessages,
  pruneZernioLogs,
  RETENTION,
} from "@/core/retention/retention";

/**
 * Ретеншн против настоящей базы: смысл прохода в том, какие строки PostgREST
 * реально отдаёт под фильтр, а не в том, что вернул мок. Строки помечены
 * своим event_id/actor и убираются за собой.
 */
const TAG = "v2-retention-probe";
const TG = -990000777099;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

async function cleanup() {
  const db = serviceDb();
  await db.from("zernio_logs").delete().eq("bot_id", DEMO_BOT).like("event_id", `${TAG}%`);
  await db.from("manager_chat_messages").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db.from("admin_login_attempts").delete().eq("bot_id", DEMO_BOT).eq("ip", TAG);
  await db.from("bot_events").delete().eq("bot_id", DEMO_BOT).eq("actor", TAG);
}

describe.skipIf(!liveReady)("ретеншн журналов", () => {
  beforeAll(async () => {
    await cleanup();
    const db = serviceDb();
    const logs = [
      { event_id: `${TAG}-old-ok`, status: "processed", created_at: daysAgo(3000) },
      { event_id: `${TAG}-old-ignored`, status: "ignored", created_at: daysAgo(3000) },
      {
        event_id: `${TAG}-old-failed`,
        status: "failed",
        created_at: daysAgo(RETENTION.zernioLogsDays + 1),
      },
      {
        event_id: `${TAG}-ancient-failed`,
        status: "failed",
        created_at: daysAgo(3000),
      },
      { event_id: `${TAG}-fresh`, status: "processed", created_at: daysAgo(1) },
    ].map((r) => ({ ...r, bot_id: DEMO_BOT, event_type: "message.received", payload: {} }));
    const { error } = await db.from("zernio_logs").insert(logs);
    if (error) throw new Error(error.message);
    await db.from("manager_chat_messages").insert([
      {
        bot_id: DEMO_BOT,
        telegram_id: TG,
        direction: "in",
        sender: "customer",
        text: "old",
        created_at: daysAgo(3000),
      },
      {
        bot_id: DEMO_BOT,
        telegram_id: TG,
        direction: "in",
        sender: "customer",
        text: "fresh",
        created_at: daysAgo(1),
      },
    ]);
    await db.from("admin_login_attempts").insert([
      { bot_id: DEMO_BOT, ip: TAG, ok: false, at: daysAgo(3000) },
      { bot_id: DEMO_BOT, ip: TAG, ok: true, at: daysAgo(1) },
    ]);
    await db.from("bot_events").insert([
      {
        bot_id: DEMO_BOT,
        actor: TAG,
        kind: "meta",
        payload: {},
        at: daysAgo(3000),
      },
      { bot_id: DEMO_BOT, actor: TAG, kind: "meta", payload: {}, at: daysAgo(1) },
    ]);
  });
  afterAll(cleanup);

  it("zernio_logs: отработанные старше 30 дней уходят, сбои живут 180, свежее остаётся", async () => {
    // В общей базе лежат тысячи старых строк v1 — проход идёт порциями, старые
    // первыми; доводим до конца, как это сделали бы несколько запусков крона.
    const r = await pruneZernioLogs();
    expect(r.deleted).toBeGreaterThanOrEqual(3);
    const { data } = await serviceDb()
      .from("zernio_logs")
      .select("event_id")
      .eq("bot_id", DEMO_BOT)
      .like("event_id", `${TAG}%`);
    const left = (data ?? []).map((x) => x.event_id).sort();
    expect(left).toEqual([`${TAG}-fresh`, `${TAG}-old-failed`]);
  });

  it("переписка, попытки входа и события: старое удаляется, свежее остаётся", async () => {
    await pruneManagerChatMessages();
    await pruneAdminLoginAttempts();
    await pruneBotEvents();
    const db = serviceDb();
    const chat = await db
      .from("manager_chat_messages")
      .select("text")
      .eq("bot_id", DEMO_BOT)
      .eq("telegram_id", TG);
    expect((chat.data ?? []).map((x) => x.text)).toEqual(["fresh"]);
    const logins = await db
      .from("admin_login_attempts")
      .select("ok")
      .eq("bot_id", DEMO_BOT)
      .eq("ip", TAG);
    expect((logins.data ?? []).map((x) => x.ok)).toEqual([true]);
    const events = await db.from("bot_events").select("at").eq("bot_id", DEMO_BOT).eq("actor", TAG);
    expect(events.data?.length).toBe(1);
  });
});
