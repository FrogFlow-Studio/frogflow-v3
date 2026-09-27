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
  /** Задача со страницы и её решение браузером — см. challenge.ts. */
  challenge: z.string().max(200).optional(),
  answer: z.string().max(20).optional(),
  /** Откуда пришёл (utm/ref лендинга, страница ниши); мусор отбрасывается и регистрацию не срывает. */
  source: z.string().max(64).optional().catch(undefined),
  page: z.string().max(20).optional().catch(undefined),
});

export const signupEnabledFn = createServerFn({ method: "GET" }).handler(async () => {
  const { env } = await import("@/config/env");
  if (env().SIGNUP_ENABLED !== "1") return { enabled: false as const, challenge: "" };
  const { issueChallenge } = await import("./challenge");
  return { enabled: true as const, challenge: issueChallenge(env().SESSION_SECRET) };
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
    const { claimChallenge, ipHash, signupRefusal } = await import("./signup.server");
    const { challengeNonce, verifyChallenge } = await import("./challenge");
    await loginDelay();
    const failed = verifyChallenge(env().SESSION_SECRET, data.challenge, data.answer);
    if (failed) throw new Error(failed);
    const nonce = challengeNonce(data.challenge!)!;
    const hash = ipHash(clientIp());
    const refusal = await signupRefusal(hash, nonce);
    if (refusal) throw new Error(refusal);
    const claimed = await claimChallenge(nonce);
    if (claimed) throw new Error(claimed);
    const username = data.username.toLowerCase();
    const { signupOrigin } = await import("@/core/signup/origin");
    const id = await createClient({
      name: data.name.trim(),
      ownerId: username,
      vertical: data.vertical as (typeof VERTICAL_KEYS)[number],
      ownerContact: data.contact,
      admin: { username, password: data.password },
      actor: "signup",
      ipHash: hash,
      challenge: nonce,
      signup: signupOrigin({ source: data.source, page: data.page }),
    });
    // Пробный период Basic включается сам. Сбой не ломает регистрацию:
    // магазин уже создан, оператор включит пробный период кнопкой.
    try {
      const { nicheForVertical } = await import("@/core/plans/registry");
      if (nicheForVertical(data.vertical as (typeof VERTICAL_KEYS)[number]))
        await (await import("@/app/operator/plans.server")).startTrial(id, "signup");
    } catch (e) {
      console.error(`[signup] trial for ${id} failed: ${e instanceof Error ? e.message : e}`);
    }
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
        ...(await import("@/app/auth/session-id")).issueSession(),
      },
    });
    return { ok: true as const, botId: id };
  });
