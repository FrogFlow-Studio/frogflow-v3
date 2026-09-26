import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { env } from "@/config/env";
import type { Database } from "@/core/db-types";

const body = z.object({
  /** Существующий клиент (строка bots) — или пусто, чтобы завести нового. */
  bot_id: z.string().uuid().optional(),
  bot_name: z.string().min(1).optional(),
  owner_id: z.string().min(1).optional(),
  vertical: z.string().optional(),
  /** Токен из BotFather. Шифруется и ложится в bots.bot_token. */
  telegram_token: z
    .string()
    .regex(/^\d+:[\w-]{30,}$/)
    .optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{2,40}$/)
    .optional(),
  hosts: z.array(z.string()).optional(),
  zernio_account_ids: z.array(z.string()).optional(),
  /** Переключить обслуживание клиента на v2 (и поставить вебхук) или вернуть на v1. */
  served_by: z.enum(["v1", "v2"]).optional(),
  /** Перевести на v2, даже если предполётная проверка против (осознанно, оператором). */
  force: z.boolean().optional(),
});

/**
 * Минимальный API оператора: подключить клиента к v2 без Vercel и без
 * переменных окружения. Пока панели оператора в v2 нет, этим пользуется
 * scripts/onboard.mjs. Basic-auth учётной записью оператора.
 *
 * Переезд клиента с v1: PATCH {bot_id, telegram_token, served_by: "v2"} —
 * токен шифруется, затем предполётная проверка (как переключатель в панели:
 * блокирующие пункты — 409 со списком, клиент остаётся на v1), и вебхук
 * переставляется на этот деплой. Откат: {served_by: "v1"} — кнопка меню
 * возвращается к стандартной, вебхук забирает крон деплоя v1.
 */
export const Route = createFileRoute("/api/operator/bots")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const e = env();
        const { basicCredentials } = await import("@/lib/cron-auth");
        const { verifyOperator } = await import("@/app/operator/credentials.server");
        const { clientIp, loginLocked, recordLogin, loginDelay } =
          await import("@/app/auth/login-guard.server");
        const unauthorized = () =>
          new Response("unauthorized", {
            status: 401,
            headers: { "www-authenticate": "Basic" },
          });
        const cred = basicCredentials(request);
        if (!cred) return unauthorized();
        // Тот же антибрут, что у формы входа: попытки пишутся в один журнал.
        const ip = clientIp(request);
        await loginDelay();
        if (await loginLocked("operator", ip))
          return new Response("too many attempts", {
            status: 429,
            headers: { "retry-after": "900" },
          });
        const ok = await verifyOperator(cred.username, cred.password);
        await recordLogin("operator", ip, ok, cred.username.slice(0, 80));
        if (!ok) return unauthorized();
        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const input = parsed.data;

        const { serviceDb } = await import("@/core/db/client.server");
        const { encryptSecret } = await import("@/core/secrets/vault");
        const { telegramApi } = await import("@/channels/telegram/api");
        const { MODULE_KEYS } = await import("@/core/modules/registry");
        const { invalidateTenantDirectory, resolveTenant } =
          await import("@/core/tenant/resolve.server");
        const { ensureTelegramWebhook } = await import("@/core/tenant/telegram-webhook.server");
        const db = serviceDb();

        let botUsername: string | undefined;
        if (input.telegram_token) {
          const me = await telegramApi(input.telegram_token, e.TELEGRAM_API_BASE).call<{
            username?: string;
          }>("getMe");
          if (!me.ok)
            return Response.json(
              { error: `Telegram отверг токен: ${me.description ?? "getMe failed"}` },
              { status: 400 },
            );
          botUsername = me.result?.username;
        }

        let botId = input.bot_id;
        if (!botId) {
          if (!input.bot_name || !input.owner_id)
            return Response.json(
              { error: "для нового клиента нужны bot_name и owner_id" },
              { status: 400 },
            );
          const modules = Object.fromEntries(MODULE_KEYS.map((k) => [k, k === "shop"]));
          const { data, error } = await db
            .from("bots")
            .insert({
              bot_name: input.bot_name,
              owner_id: input.owner_id,
              status: "active",
              modules,
              vertical: input.vertical ?? "digital",
            })
            .select("id")
            .single();
          if (error || !data)
            return Response.json({ error: error?.message ?? "insert failed" }, { status: 500 });
          botId = data.id;
        }

        const { data: row } = await db
          .from("bots")
          .select("settings, bot_token")
          .eq("id", botId)
          .maybeSingle();
        if (!row) return Response.json({ error: "клиент не найден" }, { status: 404 });
        const settings = (
          row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
            ? row.settings
            : {}
        ) as Record<string, unknown>;
        if (input.slug || input.hosts) {
          const { addressConflict } = await import("@/core/tenant/directory");
          const { tenantDirectory } = await import("@/core/tenant/resolve.server");
          const taken = addressConflict(await tenantDirectory(true), botId, {
            slug: input.slug,
            hosts: input.hosts,
          });
          if (taken)
            return Response.json(
              { error: `адрес «${taken.what}» уже занят клиентом «${taken.owner}»` },
              { status: 409 },
            );
        }
        const next: Record<string, unknown> = { ...settings };
        if (input.slug) next.slug = input.slug;
        if (input.hosts) next.hosts = input.hosts;
        if (input.zernio_account_ids)
          next.zernio = {
            ...((settings.zernio as object) ?? {}),
            account_ids: input.zernio_account_ids,
          };
        if (botUsername)
          next.telegram = { ...((settings.telegram as object) ?? {}), username: botUsername };
        // Существующий клиент переезжает на v2 только после предполётной
        // проверки — её делаем ниже, когда токен уже записан.
        const prevServedBy = settings.served_by;
        const needsPreflight =
          input.served_by === "v2" &&
          prevServedBy !== "v2" &&
          Boolean(input.bot_id) &&
          !input.force;
        if (input.served_by && !needsPreflight) next.served_by = input.served_by;

        const patch: Database["public"]["Tables"]["bots"]["Update"] = { settings: next as never };
        if (input.telegram_token)
          patch.bot_token = encryptSecret(input.telegram_token, e.SECRETS_KEY);
        if (input.vertical) patch.vertical = input.vertical;
        if (input.bot_name) patch.bot_name = input.bot_name;
        const { error: upErr } = await db.from("bots").update(patch).eq("id", botId);
        if (upErr) return Response.json({ error: upErr.message }, { status: 500 });
        invalidateTenantDirectory();

        if (needsPreflight) {
          const { preflight } = await import("@/app/operator/migration.server");
          const { preflightBlockers } = await import("@/core/tenant/preflight");
          const p = await preflight(botId);
          if (!p.ready)
            return Response.json(
              {
                error: `Клиента нельзя перевести на v2: ${preflightBlockers(p).join("; ")}.`,
                bot_id: botId,
                served_by: prevServedBy ?? null,
                checks: p.checks,
              },
              { status: 409 },
            );
          const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
          await patchTenantSettings(botId, { served_by: "v2" });
        }
        if (input.served_by || input.force) {
          const { logEvent } = await import("@/app/operator/operator.server");
          await logEvent(
            botId,
            "webhook",
            { action: "served_by", value: input.served_by ?? null, force: Boolean(input.force) },
            `api:${cred.username.slice(0, 40)}`,
          ).catch(() => undefined);
        }

        const tenant = await resolveTenant({ by: "id", value: botId });
        const { releasesTelegramOnSwitch } = await import("@/core/tenant/preflight");
        if (
          tenant &&
          releasesTelegramOnSwitch(prevServedBy as string | undefined, input.served_by)
        ) {
          const { releaseTelegramToV1 } = await import("@/core/tenant/telegram-webhook.server");
          await releaseTelegramToV1(tenant).catch((x) =>
            console.warn(`[operator-api] menu button reset for ${botId}: ${String(x)}`),
          );
        }
        const webhook =
          tenant && tenant.settings.served_by === "v2"
            ? await ensureTelegramWebhook(tenant, true)
            : null;
        return Response.json({
          bot_id: botId,
          bot_username: botUsername ?? tenant?.settings.telegram?.username ?? null,
          served_by: tenant?.settings.served_by ?? null,
          webhook,
        });
      },
    },
  },
});
