import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Ключ публичного API магазина (модуль public_api): только владелец. */
const owner = async () =>
  (await import("@/app/auth/guards.server")).requireAdminModule("public_api", "owner");

export const apiKeyStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await owner();
  const { loadApiKeyMeta, loadApiKeyUse } = await import("@/core/api/public-api");
  const meta = await loadApiKeyMeta(ctx);
  if (!meta) return { exists: false as const };
  return {
    exists: true as const,
    last4: meta.last4,
    createdAt: meta.createdAt,
    scope: meta.scope,
    lastUse: await loadApiKeyUse(ctx),
  };
});

/** Новый ключ взамен прежнего: прежний перестаёт работать сразу, новый виден один раз. */
export const createApiKeyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ scope: z.enum(["read", "write"]) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await owner();
    const { createApiKey } = await import("@/core/api/public-api");
    const { token, meta } = await createApiKey(ctx, new Date(), data.scope);
    return { token, last4: meta.last4, createdAt: meta.createdAt, scope: meta.scope };
  });

export const revokeApiKeyFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await owner();
  const { revokeApiKey } = await import("@/core/api/public-api");
  await revokeApiKey(ctx);
  return { ok: true };
});
