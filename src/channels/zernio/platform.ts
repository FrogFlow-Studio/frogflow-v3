/**
 * Каналы Zernio, под которые в v2 есть обработчик. Сам Zernio отдаёт платформу
 * произвольной строкой (facebook, tiktok…) — всё, чего здесь нет, отбивается
 * на входе вебхука, а не доезжает до покупателя «платформой без обработчика».
 */
export type ZernioPlatform = "instagram" | "whatsapp";

export function isZernioPlatform(value: string | null | undefined): value is ZernioPlatform {
  return value === "instagram" || value === "whatsapp";
}

/** Название канала в текстах для продавца. */
export const PLATFORM_LABEL: Record<ZernioPlatform, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};
