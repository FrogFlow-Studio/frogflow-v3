import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { REPORT_REASONS } from "@/core/marketplace/report";

const target = z.object({
  slug: z.string().max(80),
  product: z.string().max(40).optional().catch(undefined),
});

/** Форма жалобы: название магазина (и товара) и задача против ботов. Не на площадке — `shop: null`. */
export const reportFormFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => target.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { env } = await import("@/config/env");
    const { issueChallenge } = await import("@/app/signup/challenge");
    const { cleanReport } = await import("@/core/marketplace/report");
    const { describeTarget } = await import("@/core/marketplace/report.server");
    const clean = cleanReport({ slug: data.slug, productId: data.product, reason: "fraud" });
    if (!clean.ok) return { shop: null, product: null, challenge: "" };
    const t = await describeTarget(clean.value.slug, clean.value.productId);
    return {
      shop: t?.shop ?? null,
      product: t?.product ?? null,
      challenge: issueChallenge(env().SESSION_SECRET, Date.now(), "market"),
    };
  });

const input = z.object({
  slug: z.string().max(80),
  productId: z.string().max(40),
  reason: z.enum(REPORT_REASONS),
  text: z.string().max(2000),
  /** Случайный номер устройства из браузера: на сервере только его хеш. */
  device: z.string().max(64),
  /** Приманка для ботов: человек поле не видит и не заполняет. */
  website: z.string().max(0).optional(),
  challenge: z.string().max(200),
  answer: z.string().max(20),
});

export type ReportResult =
  { ok: true } | { ok: false; error: "text" | "unknown" | "ip" | "refresh" | "fast" };

/**
 * Жалоба на магазин или товар: публичная, без входа. Защита — задача для браузера, поле-приманка,
 * одна жалоба с адреса и устройства на объект в сутки и потолок с адреса (core/marketplace/report.server).
 * Повторная жалоба отвечает так же, как первая: по ответу не понять, жаловались ли уже.
 */
export const submitReportFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data }): Promise<ReportResult> => {
    const { env } = await import("@/config/env");
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
    const { cleanReport } = await import("@/core/marketplace/report");
    const form = cleanReport(data);
    if (!form.ok) return { ok: false, error: form.error === "reason" ? "unknown" : "text" };
    const { claimChallenge, ipHash } = await import("@/app/signup/signup.server");
    if (await claimChallenge(challengeNonce(data.challenge)!))
      return { ok: false, error: "refresh" };
    const { sha256Hex } = await import("@/lib/hash");
    const device = /^[0-9a-f]{32}$/.test(data.device)
      ? sha256Hex(`ff-market-report\0${data.device}`, 32)
      : null;
    const { submitReport } = await import("@/core/marketplace/report.server");
    const r = await submitReport(form.value, ipHash(clientIp()), device);
    return r.status === "refused" ? { ok: false, error: r.reason } : { ok: true };
  });
