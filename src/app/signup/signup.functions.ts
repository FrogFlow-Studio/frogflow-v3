import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { VERTICAL_KEYS } from "@/core/verticals/registry";

const input = z.object({
  name: z.string().min(2).max(120),
  username: z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,39}$/, "латиница, цифры, точка, дефис"),
  password: z.string().min(8).max(200),
  vertical: z.enum(VERTICAL_KEYS as [string, ...string[]]),
  contact: z.string().max(200).optional(),
  /** Приманка для ботов: поле скрыто, человек его не заполняет. */
  website: z.string().max(0).optional(),
});

export const signupEnabledFn = createServerFn({ method: "GET" }).handler(async () => {
  const { env } = await import("@/config/env");
  return { enabled: env().SIGNUP_ENABLED === "1" };
});

/** Продавец регистрируется сам: магазин, логин, вход в админку. Токен бота подключит в настройках. */
export const signupFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const { env } = await import("@/config/env");
    if (env().SIGNUP_ENABLED !== "1")
      throw new Error("Регистрация закрыта — обратитесь к оператору.");
    const { createClient } = await import("@/app/operator/operator.server");
    const { appSession } = await import("@/app/auth/session.server");
    const { clientIp, loginDelay } = await import("@/app/auth/login-guard.server");
    const { ipHash, signupRefusal } = await import("./signup.server");
    await loginDelay();
    const hash = ipHash(clientIp());
    const refusal = await signupRefusal(hash);
    if (refusal) throw new Error(refusal);
    const username = data.username.toLowerCase();
    const id = await createClient({
      name: data.name.trim(),
      ownerId: username,
      vertical: data.vertical as (typeof VERTICAL_KEYS)[number],
      ownerContact: data.contact,
      admin: { username, password: data.password },
      actor: "signup",
      ipHash: hash,
    });
    const { requireTenant } = await import("@/core/tenant/resolve.server");
    const { loginInTenant } = await import("@/core/auth/roles");
    const { adminStamp } = await import("@/app/auth/guards.server");
    const login = loginInTenant(await requireTenant({ by: "id", value: id }), username);
    await (
      await appSession()
    ).update({
      admin: {
        botId: id,
        username,
        role: "owner",
        stamp: adminStamp(id, username, login?.passwordHash),
      },
    });
    return { ok: true as const, botId: id };
  });
