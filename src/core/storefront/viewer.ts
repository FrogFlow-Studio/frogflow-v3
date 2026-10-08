/**
 * Просмотр фото товара на весь экран (Т6): чистая логика листания, жестов и
 * увеличения. Сам просмотр — `app/storefront/photo-viewer.tsx`.
 */

/** Следующее/предыдущее фото без перескока по кругу: на краю остаёмся на месте. */
export function stepIndex(i: number, d: -1 | 1, n: number): number {
  if (n <= 0) return 0;
  return Math.min(n - 1, Math.max(0, i + d));
}

/** Порог жеста в пикселях: меньше — это тап, а не свайп. */
export const SWIPE_MIN = 50;

/**
 * Жест одним пальцем без увеличения: влево — следующее фото, вправо —
 * предыдущее, вниз — закрыть. Берётся преобладающее направление.
 */
export function swipeAction(dx: number, dy: number): "next" | "prev" | "close" | null {
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx <= -SWIPE_MIN) return "next";
    if (dx >= SWIPE_MIN) return "prev";
    return null;
  }
  return dy >= SWIPE_MIN * 2 ? "close" : null;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** Двойной тап: из обычного размера — сюда, из увеличенного — обратно. */
export const ZOOM_TAP = 2.5;

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Увеличение двумя пальцами: во столько раз, во сколько выросло расстояние между ними. */
export function pinchZoom(startZoom: number, startDist: number, dist: number): number {
  if (startDist <= 0) return clampZoom(startZoom);
  return clampZoom((startZoom * dist) / startDist);
}

/** Двойной тап переключает обычный размер и увеличение. */
export const toggleZoom = (z: number): number => (z > ZOOM_MIN ? ZOOM_MIN : ZOOM_TAP);
