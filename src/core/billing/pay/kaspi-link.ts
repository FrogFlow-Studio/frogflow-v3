import qrcode from "qrcode-generator";
import type { IssueRequest, SubscriptionPayProvider } from "./provider";

/**
 * Ссылка Kaspi Pay магазина платформы: оператор создаёт её в своём Kaspi Pay
 * и вставляет в настройки платформы. Владелец открывает ссылку (или QR с
 * неё) в приложении Kaspi, вводит сумму счёта и платит, потом присылает чек
 * в бота — дальше счёт закрывает автопроверка чека. К Kaspi мы не ходим:
 * ссылка лишь показывается владельцу.
 */
export const KASPI_LINK_KEY = "kaspi_pay_link";

/** https-ссылка на kaspi.kz или его поддомен; иначе null. */
export function normalizeKaspiLink(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (host !== "kaspi.kz" && !host.endsWith(".kaspi.kz")) return null;
  return u.toString();
}

/** QR со ссылкой в виде SVG, чтобы владелец навёл камеру с другого устройства. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

export function kaspiLinkText(
  req: Pick<IssueRequest, "amount" | "currency" | "note">,
  link: string,
) {
  return (
    `Счёт на оплату подписки\n\nСумма: ${req.amount} ${req.currency}${req.note ? `\nЗа что: ${req.note}` : ""}` +
    `\n\nОплатить через Kaspi: ${link}\nВведите ровно ${req.amount} ₸ — чек с другой суммой не примется автоматически.` +
    `\n\nПосле оплаты пришлите, пожалуйста, чек (PDF или скриншот) следующим сообщением в этот чат.`
  );
}

/** Способ оплаты по ссылке; ссылку читает `getLink` (настройка оператора). */
export function kaspiLinkProvider(getLink: () => Promise<string>): SubscriptionPayProvider {
  return {
    key: "kaspi_link",
    async unavailable(req) {
      if (req.currency !== "KZT") return "Kaspi принимает только тенге.";
      return normalizeKaspiLink(await getLink())
        ? null
        : "Ссылка Kaspi Pay не задана — заполните её в настройках платформы.";
    },
    async issue(req) {
      const link = normalizeKaspiLink(await getLink());
      if (!link) throw new Error("Ссылка Kaspi Pay не задана.");
      return {
        provider: "kaspi_link",
        externalId: null,
        ownerText: kaspiLinkText(req, link),
        payUrl: link,
      };
    },
  };
}
