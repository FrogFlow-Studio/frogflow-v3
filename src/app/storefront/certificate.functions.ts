import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Страница проверки сертификата: по коду, без входа (app/storefront/certificate.server). */
export const certificateViewFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ slug: z.string().max(40), code: z.string().max(20) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { certificateView } = await import("./certificate.server");
    const view = await certificateView(data.slug, data.code);
    if (!view) throw notFound();
    return view;
  });
