import type { OutboxSender } from "@/core/outbox/outbox";
import { liveTransport, type ZernioTransport } from "./api.server";
import { plain } from "./shop-flow";

/** Исходящее в Instagram/WhatsApp из очереди — в тот же диалог Zernio. */
export function zernioOutboxSender(transport: ZernioTransport = liveTransport): OutboxSender {
  return async (_ctx, msg) => {
    if (msg.target.channel !== "zernio") return { ok: false, error: "не Zernio" };
    const r = await transport.send(
      msg.target.conversationId,
      msg.target.accountId,
      plain(msg.text ?? ""),
      { platform: msg.target.platform },
    );
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? "zernio send failed" };
  };
}
