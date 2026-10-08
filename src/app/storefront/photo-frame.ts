import { useMatch } from "@tanstack/react-router";
import { photoFrame, type PhotoShape } from "@/core/storefront/design";

/**
 * Рамка фото товара по настройке магазина «Форма фото в каталоге» (Т1).
 * Вне витрины (нет данных `/s/$slug`) — квадрат, как раньше.
 */
export function usePhotoFrame(): ReturnType<typeof photoFrame> & { shape: PhotoShape } {
  const shop = useMatch({ from: "/s/$slug", shouldThrow: false });
  const shape = shop?.loaderData?.design.photo ?? "square";
  return { ...photoFrame(shape), shape };
}
