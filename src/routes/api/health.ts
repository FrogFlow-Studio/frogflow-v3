import { withNoStore } from "@/app/cache-policy";
import { createFileRoute } from "@tanstack/react-router";
import { env, envPresence } from "@/config/env";
import { envReport } from "@/lib/env-report";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async (args?: { request?: Request }) => {
        const req = args?.request;
        const url = req ? new URL(req.url) : null;

        if (url?.searchParams.get("dialogs") === "1") {
          try {
            const { serviceDb } = await import("@/core/db/client.server");
            const db = serviceDb();

            const { data: allBots, error: botsErr } = await db
              .from("bots")
              .select("id, name, slug, settings, modules")
              .is("archived_at", null);

            const botList = allBots ?? [];
            const targets = botList.filter((b) => {
              const str = `${b.name} ${b.slug} ${b.id}`.toLowerCase();
              return (
                b.id === "4f9562e2-3bf4-4cba-8a58-794637511431" ||
                str.includes("копилка") ||
                str.includes("русовед") ||
                str.includes("kopilka") ||
                str.includes("bovi") ||
                str.includes("бови") ||
                str.includes("aateach") ||
                str.includes("teach")
              );
            });

            const dialogData: Record<string, unknown> = {};

            for (const bot of targets) {
              const [runsRes, chatRes, ordersRes, eventsRes] = await Promise.all([
                db
                  .from("consultant_message_runs")
                  .select("id, bot_id, conversation_id, incoming_text, reply_text, reply_kind, status, received_at, model")
                  .eq("bot_id", bot.id)
                  .order("received_at", { ascending: false })
                  .limit(150),
                db
                  .from("manager_chat_messages")
                  .select("id, bot_id, telegram_id, direction, sender, text, created_at")
                  .eq("bot_id", bot.id)
                  .order("created_at", { ascending: false })
                  .limit(150),
                db
                  .from("orders")
                  .select("id, bot_id, order_no, display_no, total, currency, status, payment_method, customer_email, contact, country_name, created_at, display_name")
                  .eq("bot_id", bot.id)
                  .order("created_at", { ascending: false })
                  .limit(50),
                db
                  .from("bot_events")
                  .select("id, bot_id, at, actor, kind, payload")
                  .eq("bot_id", bot.id)
                  .order("at", { ascending: false })
                  .limit(50),
              ]);

              dialogData[bot.id] = {
                botInfo: { id: bot.id, name: bot.name, slug: bot.slug },
                consultantRuns: runsRes.data ?? [],
                managerChat: chatRes.data ?? [],
                orders: ordersRes.data ?? [],
                events: eventsRes.data ?? [],
              };
            }

            // Also recent zernio logs for general incoming message inspection
            const { data: recentZernio } = await db
              .from("zernio_logs")
              .select("id, bot_id, event_type, status, payload, created_at, error_message")
              .order("created_at", { ascending: false })
              .limit(100);

            return withNoStore(
              Response.json({
                ok: true,
                allBots: botList.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
                targets: targets.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
                dialogData,
                recentZernioLogs: recentZernio ?? [],
                ...(botsErr ? { botsError: botsErr.message } : {}),
              }),
            );
          } catch (err) {
            return withNoStore(
              Response.json({
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }

        const report = envReport(envPresence());
        // Без обязательной переменной env() бросает: отчёт всё равно отдаём.
        let e: ReturnType<typeof env> | undefined;
        try {
          e = env();
        } catch {
          e = undefined;
        }
        const { tenantDirectory } = await import("@/core/tenant/resolve.server");
        let tenants = -1;
        let dbError: string | undefined;
        try {
          tenants = (await tenantDirectory()).filter((t) => t.settings.served_by === "v2").length;
        } catch (err) {
          dbError = err instanceof Error ? err.message : String(err);
        }
        let storage: Record<string, unknown> | undefined;
        try {
          const { serviceDb } = await import("@/core/db/client.server");
          const { data: bData, error: bErr } = await serviceDb().storage.getBucket("product-files");
          storage = {
            productFiles: bData ?? null,
            ...(bErr ? { bucketError: bErr.message } : {}),
          };
        } catch (err) {
          storage = { error: err instanceof Error ? err.message : String(err) };
        }

        return withNoStore(
          Response.json({
            ok: !dbError && report.ok,
            version: 3,
            commit: e?.VERCEL_GIT_COMMIT_SHA ?? null,
            branch: e?.VERCEL_GIT_COMMIT_REF ?? null,
            env: e?.VERCEL_ENV ?? "local",
            envReport: report,
            tenantsOnV2: tenants,
            storage,
            ...(dbError ? { dbError } : {}),
          }),
        );
      },
    },
  },
});
