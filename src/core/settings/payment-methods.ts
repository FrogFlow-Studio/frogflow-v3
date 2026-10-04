import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database } from "@/core/db-types";
import { serverFailure } from "@/lib/server-failure";

type Row = Database["public"]["Tables"]["payment_methods"]["Row"];

export async function listPaymentMethods(ctx: TenantContext): Promise<Row[]> {
  const { data, error } = await ctx.db
    .from("payment_methods")
    .select("*")
    .order("sort_order")
    .order("country_code");
  if (error) throw serverFailure(error.message);
  return data ?? [];
}

export type PaymentMethodInput = {
  countryCode: string;
  countryName: string;
  currency: string;
  instructions: string;
  qrCodePath: string | null;
  isActive: boolean;
  sortOrder: number;
};

export async function savePaymentMethod(
  ctx: TenantContext,
  id: string | null,
  i: PaymentMethodInput,
): Promise<string> {
  if (i.qrCodePath && !i.qrCodePath.startsWith(`${ctx.tenant.id}/`))
    throw new Error("Ключ QR вне префикса клиента.");
  const row = {
    country_code: i.countryCode.toUpperCase(),
    country_name: i.countryName.trim(),
    currency: i.currency.toUpperCase(),
    instructions: i.instructions,
    qr_code_path: i.qrCodePath,
    is_active: i.isActive,
    sort_order: i.sortOrder,
  };
  if (id) {
    const { error } = await ctx.db.from("payment_methods").update(row).eq("id", id);
    if (error) throw serverFailure(error.message);
    return id;
  }
  const { data, error } = await ctx.db
    .from("payment_methods")
    .insert({ bot_id: ctx.tenant.id, ...row })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  return data.id;
}

export async function deletePaymentMethod(ctx: TenantContext, id: string): Promise<void> {
  const { error } = await ctx.db.from("payment_methods").delete().eq("id", id);
  if (error) throw serverFailure(error.message);
}
