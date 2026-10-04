import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Диагностика канала клиента (О4). Начинается с requireOperator(); только чтение,
 * клиентам и покупателям ничего не отправляет.
 */
export const diagnoseChannelFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ botId: z.string().uuid(), channel: z.enum(["telegram", "instagram", "whatsapp"]) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await (await import("@/app/auth/guards.server")).requireOperator();
    return (await import("./channel-diagnosis.server")).diagnoseChannel(data.botId, data.channel);
  });
