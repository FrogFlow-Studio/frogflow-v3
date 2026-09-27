import type { MaterialSender } from "@/core/orders/orders";
import { signedFileUrl } from "@/core/orders/orders";
import { materialDownloadName } from "@/core/orders/pure";
import type { ZernioTransport } from "./api.server";
import { classifyZernioFailure } from "./errors";
import type { ZernioPlatform } from "./platform";

export type ZernioDeliveryOptions = {
  /**
   * Подписанная страница заказа (core/storefront/web-order orderPageUrl): в
   * каждом сообщении о выдаче, как кнопка на страницу файлов в v1. Там файлы
   * подписываются заново, когда ссылки в переписке истекут.
   */
  pageUrl?: string | null;
  /**
   * Окно 24 часа закрыто (errors.ts: window_closed). Файлы уже ждут на
   * странице заказа, поэтому позиция считается выданной, а канал сообщает
   * покупателю другим путём (шаблон WhatsApp, письмо) и объясняет продавцу.
   * Зовётся один раз на выдачу.
   */
  onWindowClosed?: () => Promise<void>;
};

/**
 * Выдача материалов в Instagram Direct / WhatsApp: ссылками. Внешняя ссылка —
 * как есть; файл из хранилища — подписанной ссылкой на 7 дней (Direct не
 * принимает документы с сервера, WhatsApp принимает, но ссылка работает в
 * обоих каналах одинаково и не упирается в размер). Плюс ссылка на страницу
 * заказа, где файлы живут дольше 7 дней.
 */
export function zernioMaterialSender(
  transport: ZernioTransport,
  conversationId: string,
  accountId: string,
  platform: ZernioPlatform,
  opts: ZernioDeliveryOptions = {},
): MaterialSender {
  let windowClosed: Promise<void> | null = null;
  return async (item, materials) => {
    const lines: string[] = [`📁 ${item.name_snapshot}`];
    for (const mat of materials) {
      const url =
        mat.url ??
        (mat.path
          ? await signedFileUrl(
              mat.path,
              undefined,
              materialDownloadName(mat, item.name_snapshot, materials),
            )
          : null);
      if (!url) return "failed";
      lines.push(`${mat.name ? `${mat.name}: ` : ""}${url}`);
    }
    if (materials.some((m) => m.path)) lines.push("", "Ссылки на файлы действуют 7 дней.");
    if (opts.pageUrl) lines.push("", `Все файлы заказа — на странице: ${opts.pageUrl}`);
    // Позиция + тело: повтор после таймаута не шлёт ссылки второй раз.
    const r = await transport.send(conversationId, accountId, lines.join("\n"), {
      platform,
      idempotencyScope: `deliver:${item.id}`,
    });
    if (r.ok) return "sent";
    if (opts.pageUrl && classifyZernioFailure(r.failure) === "window_closed") {
      windowClosed ??= (opts.onWindowClosed?.() ?? Promise.resolve()).catch((e) =>
        console.warn(`[zernio] выдача при закрытом окне: ${String(e)}`),
      );
      await windowClosed;
      return "sent";
    }
    return "failed";
  };
}
