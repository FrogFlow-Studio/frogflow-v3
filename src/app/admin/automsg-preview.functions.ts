import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Предпросмотр автосообщений и «отправить себе» (Р5): модуль карточки, роль не ниже менеджера. */
const input = z.object({
  kind: z.enum(["cart", "winback", "similar"]),
  /** Несохранённые правки формы: разбираются теми же parse*, что и сохранение. */
  draft: z.record(z.string(), z.unknown()).optional(),
});

const guard = async (kind: "cart" | "winback" | "similar") =>
  (await import("@/app/auth/guards.server")).requireAdminModule(
    kind === "cart" ? "cart_reminder" : "winback",
    "manager",
  );

export const previewAutoMessageFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const ctx = await guard(data.kind);
    const { buildPreview } = await import("./automsg-preview.server");
    return buildPreview(ctx, data.kind, data.draft);
  });

export const sendAutoPreviewFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const ctx = await guard(data.kind);
    const { buildPreview, sendPreviewToSeller } = await import("./automsg-preview.server");
    const { adminTFor } = await import("./locale.server");
    const t = await adminTFor(ctx);
    const preview = await buildPreview(ctx, data.kind, data.draft);
    const sent = await sendPreviewToSeller(ctx, preview, t("autopreview.header"));
    return { sent };
  });
