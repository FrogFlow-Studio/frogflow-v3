import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Кабинет покупателя по ссылке: без сессии, секрет — сам токен в адресе. */
export const cabinetFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ botId: z.string().max(64), token: z.string().max(128) }).parse(d),
  )
  .handler(async ({ data }) =>
    (await import("./cabinet.server")).loadCabinet(data.botId, data.token),
  );
