import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import type { Gateway } from "../core/platform";
import { v4PaidFacts } from "./gateway-facts";

/**
 * Оплата магазина v4 после той же проверки подписи, что у v2. Фактов заказа
 * v4 нет — 200 без записи (числовой заказ v3 сюда не попадает). Схема не
 * открыта — 503, шлюз повторит. Флаг обслуживания отсюда не пишется.
 */

const SCHEMA = /schema must be one of|PGRST106/i;

export async function handleV4Gateway(
  kind: Gateway,
  request: Request,
  botId: string,
  tenant: Tenant,
): Promise<Response> {
  const { tenantContext } = await import("@/core/tenant/resolve.server");
  const ctx = tenantContext(tenant);
  const verified = await readVerified(kind, request, ctx);
  if (verified instanceof Response) return verified;
  const facts = v4PaidFacts(verified);
  if (!facts) return new Response("ok");
  const { v4DbOf } = await import("@/app/admin/v4-today.server");
  const { recordGatewayPayment } = await import("../core/platform");
  try {
    await recordGatewayPayment(v4DbOf(ctx), {
      botId,
      orderId: facts.orderId,
      gateway: kind,
      amountMinor: facts.amountMinor,
      currency: facts.currency,
      externalRef: facts.externalRef,
      by: kind,
    });
    return new Response("ok");
  } catch (e) {
    if (e instanceof Error && SCHEMA.test(e.message)) {
      return new Response("v4 not connected", { status: 503, headers: { "retry-after": "60" } });
    }
    throw e;
  }
}

async function readVerified(
  kind: Gateway,
  request: Request,
  ctx: TenantContext,
): Promise<unknown | Response> {
  if (kind === "stripe") return readStripe(request, ctx);
  if (kind === "kaspi" || kind === "apipay") return readKaspi(request, ctx);
  if (kind === "nowpayments") return readNow(request, ctx);
  if (kind === "prodamus") return readProdamus(request, ctx);
  return readRobokassa(request, ctx);
}

async function readStripe(request: Request, ctx: TenantContext): Promise<unknown | Response> {
  const { stripeFor } = await import("@/core/payments/payment");
  const cfg = await stripeFor(ctx);
  if (!cfg.ready) return new Response("stripe disabled", { status: 403 });
  const raw = await request.text();
  if (raw.length > 256 * 1024) return new Response("too large", { status: 413 });
  const { verifyStripeSignature } = await import("@/core/payments/stripe");
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), cfg.webhookSecret))
    return new Response("bad sign", { status: 400 });
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return new Response("bad json", { status: 400 });
  }
}

async function readKaspi(request: Request, ctx: TenantContext): Promise<unknown | Response> {
  const { kaspiApipayFor } = await import("@/core/payments/payment");
  const cfg = await kaspiApipayFor(ctx);
  if (!cfg.ready) return new Response("kaspi disabled", { status: 403 });
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > 64 * 1024) return new Response("too large", { status: 413 });
  const { verifyKaspiSignature } = await import("@/core/payments/kaspi-apipay");
  if (!verifyKaspiSignature(raw, request.headers.get("x-webhook-signature"), cfg.webhookSecret))
    return new Response("bad sign", { status: 401 });
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    return new Response("bad json", { status: 400 });
  }
}

async function readNow(request: Request, ctx: TenantContext): Promise<unknown | Response> {
  const { nowpaymentsFor } = await import("@/core/payments/payment");
  const cfg = await nowpaymentsFor(ctx);
  if (!cfg.ready) return new Response("crypto disabled", { status: 403 });
  const raw = await request.text();
  if (raw.length > 64 * 1024) return new Response("too large", { status: 413 });
  const { verifyIpn } = await import("@/core/payments/nowpayments");
  if (!verifyIpn(raw, request.headers.get("x-nowpayments-sig"), cfg.ipnSecret))
    return new Response("bad sign", { status: 400 });
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return new Response("bad json", { status: 400 });
  }
}

async function readProdamus(request: Request, ctx: TenantContext): Promise<unknown | Response> {
  const { prodamusFor } = await import("@/core/payments/payment");
  const cfg = await prodamusFor(ctx);
  if (!cfg.ready) return new Response("prodamus disabled", { status: 403 });
  const raw = await request.text();
  if (raw.length > 256 * 1024) return new Response("too large", { status: 413 });
  const { parsePhpForm, verifyProdamusSign } = await import("@/core/payments/prodamus");
  let body: Record<string, unknown>;
  try {
    body = (request.headers.get("content-type") ?? "").includes("json")
      ? (JSON.parse(raw) as Record<string, unknown>)
      : parsePhpForm(raw);
  } catch {
    return new Response("bad body", { status: 400 });
  }
  if (!verifyProdamusSign(body, request.headers.get("sign"), cfg.secretKey))
    return new Response("bad sign", { status: 400 });
  const sum = Number(body.sum ?? body.payment_sum);
  return {
    ...body,
    amount_minor: Number.isFinite(sum) ? Math.round(sum * 100) : body.amount_minor,
    external_ref: body.order_num ?? body.order_id,
  };
}

async function readRobokassa(request: Request, ctx: TenantContext): Promise<unknown | Response> {
  const action = new URL(request.url).pathname.split("/").pop();
  if (action !== "result") return new Response("ok");
  const params = new URL(request.url).searchParams;
  const outSum = params.get("OutSum");
  const invId = params.get("InvId");
  const signature = params.get("SignatureValue");
  if (!outSum || !invId || !signature) return new Response("bad request", { status: 400 });
  const { robokassaFor } = await import("@/core/payments/payment");
  const rk = await robokassaFor(ctx);
  if (!rk.ready) return new Response("robokassa disabled", { status: 403 });
  const shp: Array<[string, string]> = [];
  for (const [k, v] of params.entries()) if (k.toLowerCase().startsWith("shp_")) shp.push([k, v]);
  const { verifyResultSignature } = await import("@/core/payments/robokassa");
  if (!verifyResultSignature({ outSum, invId, signature, pass2: rk.pass2, shp }))
    return new Response("bad sign", { status: 400 });
  const order = shp.find(([k]) => k.toLowerCase() === "shp_v4order")?.[1];
  const major = Number(outSum);
  return {
    v4_order_id: order,
    amount_minor: Number.isFinite(major) ? Math.round(major * 100) : 0,
    currency: "KZT",
    external_ref: invId,
  };
}
