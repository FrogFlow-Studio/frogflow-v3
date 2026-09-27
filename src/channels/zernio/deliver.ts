import type { MaterialSender } from "@/core/orders/orders";
import { signedFileUrl } from "@/core/orders/orders";
import { materialDownloadName } from "@/core/orders/pure";
import type { ZernioTransport } from "./api.server";
import type { ZernioPlatform } from "./platform";

/**
 * Выдача материалов в Instagram Direct / WhatsApp: ссылками. Внешняя ссылка —
 * как есть; файл из хранилища — подписанной ссылкой на 7 дней (Direct не
 * принимает документы с сервера, WhatsApp принимает, но ссылка работает в
 * обоих каналах одинаково и не упирается в размер).
 */
export function zernioMaterialSender(
  transport: ZernioTransport,
  conversationId: string,
  accountId: string,
  platform: ZernioPlatform,
): MaterialSender {
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
    // Позиция + тело: повтор после таймаута не шлёт ссылки второй раз.
    const r = await transport.send(conversationId, accountId, lines.join("\n"), {
      platform,
      idempotencyScope: `deliver:${item.id}`,
    });
    return r.ok ? "sent" : "failed";
  };
}
