const IMAGE_TYPE = /^image\/(?!svg)[\w.+-]+$/i;
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);
const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/** Content-Type для публичного proxy product media; неизвестные файлы не выдаём за изображение. */
export function publicMediaContentType(
  rawType: string | null | undefined,
  path: string,
): string | null {
  const candidate = rawType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (IMAGE_TYPE.test(candidate)) return candidate;
  if (VIDEO_TYPES.has(candidate)) return candidate;

  if (!candidate || candidate === "application/octet-stream") {
    const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
    return EXTENSION_TYPES[extension] ?? null;
  }
  return null;
}
