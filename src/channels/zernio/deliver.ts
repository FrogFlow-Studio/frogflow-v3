import type { Locale } from "@/core/i18n/locale";
import type { MaterialSender } from "@/core/orders/orders";
import { signedFileUrl } from "@/core/orders/orders";
import { materialDownloadName } from "@/core/orders/pure";
import type { ZernioTransport } from "./api.server";
import { COPY } from "@/channels/telegram/copy";
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
  /** Язык покупателя для строк сообщения; по умолчанию русский. */
  locale?: Locale;
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
  const m = COPY[opts.locale ?? "ru"];
  return async (item, materials) => {
    const lines: string[] = [`📁 ${item.name_snapshot}`];
    const links: Array<{ name: string | null; url: string }> = [];
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
      links.push({ name: mat.name ?? null, url });
      lines.push(`${mat.name ? `${mat.name}: ` : ""}${url}`);
    }
    const tail: string[] = [];
    if (materials.some((m) => m.path)) tail.push(`\n${m.deliveryLinksExpire}`);
    if (opts.pageUrl) tail.push(`\n${m.deliveryOrderPage} ${opts.pageUrl}`);
    // Подписанная ссылка с именем файла — около 450 знаков: два-три файла в
    // одном сообщении не влезают в лимит Instagram, и выдача падала целиком
    // (заказ #20 Копилки, 09.10). Режем на несколько сообщений по строкам.
    const parts = packLines([...lines, ...tail], TEXT_MAX[platform]);
    let r: Awaited<ReturnType<ZernioTransport["send"]>> = { ok: false };
    for (let k = 0; k < parts.length; k++) {
      // Позиция + тело: повтор после таймаута не шлёт ссылки второй раз.
      r = await transport.send(conversationId, accountId, parts[k]!, {
        platform,
        idempotencyScope: k === 0 ? `deliver:${item.id}` : `deliver:${item.id}:${k}`,
      });
      // Первая часть ушла, следующая нет — позиция не выдана, продавец
      // повторит; часть ссылок у покупателя уже есть, это не вредно.
      if (!r.ok && k > 0) return "failed";
      if (!r.ok) break;
    }
    if (r.ok) {
      // Кнопки «Скачать» — отдельным коротким сообщением после ссылок. С
      // кнопками Instagram берёт не больше 640 знаков текста, а подписанные
      // ссылки длиннее: в одном сообщении выдача падала целиком (заказ #10,
      // Кристина Дидактика, 07.10). Кнопки не дошли — файлы уже в переписке.
      const buttons = downloadButtons(platform, links, m.downloadBtn);
      if (buttons) {
        const b = await transport.send(
          conversationId,
          accountId,
          `📁 ${item.name_snapshot}`.slice(0, 600),
          {
            platform,
            idempotencyScope: `deliver-buttons:${item.id}`,
            buttons,
          },
        );
        if (!b.ok) console.warn(`[zernio] кнопки «Скачать» не ушли: ${b.error ?? ""}`);
      }
      return "sent";
    }
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

/** Лимит текста одного сообщения: Instagram — 1000 знаков (берём с запасом), WhatsApp — 4096. */
const TEXT_MAX: Record<ZernioPlatform, number> = { instagram: 950, whatsapp: 4000 };

/**
 * Строки — в сообщения не длиннее max: строка не рвётся, первая строка
 * (название позиции) повторяется в начале каждой следующей части.
 */
export function packLines(lines: string[], max: number): string[] {
  const [head = "", ...rest] = lines;
  const parts: string[] = [];
  let cur = head;
  for (const line of rest) {
    if (cur !== head && cur.length + 1 + line.length > max) {
      parts.push(cur);
      cur = head;
    }
    cur = `${cur}\n${line}`;
  }
  parts.push(cur);
  return parts;
}

/**
 * Instagram: кнопки «📥 Скачать» вторым сообщением после ссылок — файл
 * открывается прямо из Direct, без поиска ссылки в тексте. Кнопок в Direct не больше трёх:
 * при большем числе файлов остаются ссылки текстом. WhatsApp кнопки-ссылки
 * в сессионном сообщении не рисует — там только текст.
 */
export function downloadButtons(
  platform: ZernioPlatform,
  links: Array<{ name: string | null; url: string }>,
  label: string,
): Array<{ type: "url"; title: string; url: string }> | undefined {
  if (platform !== "instagram" || links.length === 0 || links.length > 3) return undefined;
  if (links.length === 1) return [{ type: "url", title: label, url: links[0]!.url }];
  return links.map((l, i) => ({
    type: "url" as const,
    title: `📥 ${l.name?.trim() || String(i + 1)}`,
    url: l.url,
  }));
}
