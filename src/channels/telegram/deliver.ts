import type { TelegramApi } from "./api";
import type { MaterialSender } from "@/core/orders/orders";
import { signedFileUrl } from "@/core/orders/orders";
import { escapeHtml, type Msg } from "./copy";

/**
 * Отправка материалов заказа в чат. Внешняя ссылка — сообщением; файл из
 * хранилища — документом по подписанной ссылке (Telegram сам скачает pdf/zip
 * до 20 МБ), иначе — ссылкой на 7 дней.
 */
export function telegramMaterialSender(api: TelegramApi, chatId: number, m: Msg): MaterialSender {
  return async (item, materials) => {
    let allOk = true;
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i]!;
      const caption = i === 0 ? `📁 <b>${escapeHtml(item.name_snapshot)}</b>` : "";
      let ok = false;
      if (mat.url) {
        const r = await api.call("sendMessage", {
          chat_id: chatId,
          text: `${caption ? caption + "\n\n" : ""}<a href="${mat.url}">${m.fileLink}</a>`,
          parse_mode: "HTML",
        });
        ok = r.ok;
      } else if (mat.path) {
        const url = await signedFileUrl(mat.path);
        if (url) {
          const ext = (mat.name ?? mat.path).split(".").pop()?.toLowerCase() ?? "";
          if (["pdf", "zip", "gif"].includes(ext)) {
            const r = await api.call("sendDocument", {
              chat_id: chatId,
              document: url,
              caption: item.name_snapshot,
            });
            ok = r.ok;
          }
          if (!ok) {
            const r = await api.call("sendMessage", {
              chat_id: chatId,
              text: `${caption ? caption + "\n\n" : ""}<a href="${url}">${m.fileLink}</a>\n\n<i>${m.fileLinkTtl}</i>`,
              parse_mode: "HTML",
            });
            ok = r.ok;
          }
        }
      }
      if (!ok) allOk = false;
    }
    return allOk ? "sent" : "failed";
  };
}
