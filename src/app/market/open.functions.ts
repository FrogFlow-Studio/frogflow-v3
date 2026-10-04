import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Задача против ботов для формы «Открыть свой магазин» (подписана своим назначением). */
export const openChallengeFn = createServerFn({ method: "GET" }).handler(async () => {
  const { env } = await import("@/config/env");
  const { issueChallenge } = await import("@/app/signup/challenge");
  return { challenge: issueChallenge(env().SESSION_SECRET, Date.now(), "market") };
});

const input = z.object({
  vertical: z.string().max(40),
  tier: z.string().max(20),
  locale: z.string().max(5),
  businessName: z.string().max(200),
  phone: z.string().max(60),
  email: z.string().max(200),
  instagramHandle: z.string().max(300),
  city: z.string().max(200),
  comment: z.string().max(1000),
  /** Приманка для ботов: человек поле не видит и не заполняет. */
  website: z.string().max(0).optional(),
  challenge: z.string().max(200),
  answer: z.string().max(20),
});

export type OpenResult =
  | { ok: true }
  | {
      ok: false;
      error: "niche" | "tier" | "name" | "contact" | "ip" | "total" | "refresh" | "fast";
    };

/**
 * Заявка «Открыть свой магазин»: публичная, без входа. Защита — задача для браузера,
 * поле-приманка, лимиты по адресу и за сутки (app/market/open.server). Повторная заявка
 * того же контакта отвечает так же, как первая: чужие контакты по ответу не проверить.
 */
export const submitOpenRequestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data }): Promise<OpenResult> => {
    const { env } = await import("@/config/env");
    const { cleanOpenRequest } = await import("@/core/marketplace/open-request");
    const { challengeNonce, verifyChallenge, CHALLENGE_TOO_FAST } =
      await import("@/app/signup/challenge");
    const { clientIp, loginDelay } = await import("@/app/auth/login-guard.server");
    await loginDelay();
    const failed = verifyChallenge(
      env().SESSION_SECRET,
      data.challenge,
      data.answer,
      Date.now(),
      undefined,
      "market",
    );
    if (failed) return { ok: false, error: failed === CHALLENGE_TOO_FAST ? "fast" : "refresh" };
    const form = cleanOpenRequest(data);
    if (!form.ok) return { ok: false, error: form.error };
    const { claimChallenge, ipHash } = await import("@/app/signup/signup.server");
    const claimed = await claimChallenge(challengeNonce(data.challenge)!);
    if (claimed) return { ok: false, error: "refresh" };
    const { submitOpenRequest } = await import("./open.server");
    const r = await submitOpenRequest(form.value, ipHash(clientIp()));
    if (r.status === "refused") return { ok: false, error: r.reason };
    return { ok: true };
  });
