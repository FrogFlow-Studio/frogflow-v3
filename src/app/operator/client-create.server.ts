import { type SignupOrigin } from "@/core/signup/origin";
import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";
import { MODULE_KEYS, moduleDef } from "@/core/modules/registry";
import { type VerticalKey } from "@/core/verticals/registry";
import { invalidateTenantDirectory, tenantDirectory } from "@/core/tenant/resolve.server";
import { pricelistDefaultFor } from "@/core/consultant/pricelist/mode";
import { addressConflict } from "@/core/tenant/directory";
import { adminLoginTaken } from "@/core/auth/roles";
import { addressTakenText, idTakenText, loginTakenText } from "@/app/signup/refusals";
import { hashPassword } from "@/app/auth/password";
import { serverFailure } from "@/lib/server-failure";
import { logEvent } from "./client-log.server";

/** Заведение и архивирование клиента. */

export async function createClient(input: {
  name: string;
  ownerId: string;
  vertical: VerticalKey;
  ownerName?: string;
  ownerContact?: string;
  admin?: { username: string; password: string };
  actor?: string;
  /** Отпечаток адреса регистрации — по нему считается лимит /signup. */
  ipHash?: string;
  /** Отпечаток решённой задачи /signup — одна задача на одну регистрацию. */
  challenge?: string;
  /** Откуда пришёл продавец (core/signup/origin); уже проверено. */
  signup?: SignupOrigin | null;
}) {
  const { data: dup, error: dupErr } = await serviceDb()
    .from("bots")
    .select("id")
    .eq("owner_id", input.ownerId)
    .limit(1)
    .maybeSingle();
  if (dupErr)
    throw serverFailure(`[operator] идентификатор клиента не проверен: ${dupErr.message}`);
  if (dup) throw new Error(idTakenText(input.ownerId));
  const dir = await tenantDirectory(true);
  if (input.admin && adminLoginTaken(dir, input.admin.username))
    throw new Error(loginTakenText(input.admin.username));
  // slug нового клиента = его идентификатор: занятый адрес не отдаём.
  const slugTaken = addressConflict(dir, null, { slug: input.ownerId });
  if (slugTaken) throw new Error(addressTakenText(slugTaken.what));
  const modules = Object.fromEntries(
    MODULE_KEYS.map((k) => [k, moduleDef(k).price === null && moduleDef(k).status === "available"]),
  );
  const settings: Record<string, unknown> = { served_by: "v2", slug: input.ownerId };
  const pricelist = pricelistDefaultFor(input.vertical, undefined);
  if (pricelist) settings.consultant_pricelist = pricelist;
  if (input.signup) settings.signup = input.signup;
  if (input.admin) {
    settings.admin = {
      username: input.admin.username,
      password_hash: hashPassword(input.admin.password),
    };
  }
  const { data, error } = await serviceDb()
    .from("bots")
    .insert({
      bot_name: input.name,
      owner_id: input.ownerId,
      vertical: input.vertical,
      status: "active",
      modules,
      owner_name: input.ownerName ?? null,
      owner_contact: input.ownerContact ?? null,
      settings: settings as Json,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  invalidateTenantDirectory();
  await logEvent(
    data.id,
    "onboard",
    {
      name: input.name,
      vertical: input.vertical,
      ...(input.ipHash ? { ip_hash: input.ipHash } : {}),
      ...(input.challenge ? { challenge: input.challenge } : {}),
    },
    input.actor ?? "operator",
  );
  return data.id;
}

export async function archiveClient(botId: string) {
  const { error } = await serviceDb()
    .from("bots")
    .update({ archived_at: new Date().toISOString(), status: "suspended" })
    .eq("id", botId);
  if (error) throw serverFailure(error.message);
  invalidateTenantDirectory();
  await logEvent(botId, "suspend", { archived: true });
}
