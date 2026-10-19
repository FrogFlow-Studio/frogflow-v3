import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");

const mediaServer = () => import("@/core/consultant/pricelist/media-catalog.server");
const pricelistServer = () => import("./pricelist.server");

export const consultantMediaOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  return (await mediaServer()).loadCatalogMediaOverview(ctx);
});

export const attachModelMediaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        key: z.string().min(1).max(200),
        modelName: z.string().min(1).max(200),
        color: z.string().max(60).optional(),
        name: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await mediaServer()).attachModelMedia(ctx, data);
  });

export const deleteModelMediaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await pricelistServer()).deleteProductMedia(ctx, data.id);
  });
