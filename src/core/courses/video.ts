/**
 * Видео урока во встроенном плеере: ссылка урока на YouTube, Vimeo, VK Видео,
 * Rutube или Kinescope превращается в адрес плеера. Хост берётся только из
 * разобранного URL (не подстрокой), идентификатор проверяется по шаблону, а
 * адрес плеера собирается заново — из чужой ссылки в iframe ничего не
 * попадает. Остальные ссылки остаются кнопкой. Модуль без базы: его читает и
 * страница курса, и заголовки.
 */
export const VIDEO_FRAME_HOSTS = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://vk.com",
  "https://rutube.ru",
  "https://kinescope.io",
] as const;

/** Политика страницы курса: во фреймах — только эти плееры. */
export const COURSE_PAGE_CSP = `frame-src 'self' ${VIDEO_FRAME_HOSTS.join(" ")}`;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{5,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/i;
const VK_PART = /^-?\d{1,12}$/;
const RUTUBE_ID = /^[0-9a-f]{32}$/i;
const KINESCOPE_ID = /^[A-Za-z0-9]{8,40}$/;

export function videoEmbed(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtu.be" && parts.length === 1)
    return YT_ID.test(parts[0]!) ? ytEmbed(parts[0]!) : null;
  if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
    const id =
      parts[0] === "watch" && parts.length === 1
        ? u.searchParams.get("v")
        : (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") &&
            parts.length === 2
          ? parts[1]
          : null;
    return id && YT_ID.test(id) ? ytEmbed(id) : null;
  }

  if (host === "vimeo.com" || host === "www.vimeo.com") {
    const [id, hash] = parts;
    if (!id || !VIMEO_ID.test(id) || parts.length > 2) return null;
    if (hash && !VIMEO_HASH.test(hash)) return null;
    return vimeoEmbed(id, hash);
  }
  if (host === "player.vimeo.com" && parts[0] === "video" && parts[1] && VIMEO_ID.test(parts[1])) {
    const h = u.searchParams.get("h");
    return vimeoEmbed(parts[1], h && VIMEO_HASH.test(h) ? h : undefined);
  }

  if (host === "vk.com" || host === "www.vk.com" || host === "vkvideo.ru" || host === "vk.ru") {
    const m = /^video(-?\d{1,12})_(\d{1,12})$/.exec(parts.length === 1 ? parts[0]! : "");
    if (!m || !VK_PART.test(m[1]!)) return null;
    return `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}`;
  }

  if (host === "rutube.ru" || host === "www.rutube.ru") {
    const id = parts[0] === "video" && parts.length <= 2 ? parts[1] : undefined;
    return id && RUTUBE_ID.test(id) ? `https://rutube.ru/play/embed/${id}` : null;
  }

  if (host === "kinescope.io" || host === "www.kinescope.io") {
    const id = parts[0] === "embed" && parts.length === 2 ? parts[1] : parts[0];
    return id && (parts.length === 1 || parts[0] === "embed") && KINESCOPE_ID.test(id)
      ? `https://kinescope.io/embed/${id}`
      : null;
  }
  return null;
}

const ytEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}`;
const vimeoEmbed = (id: string, hash?: string) =>
  `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ""}`;
