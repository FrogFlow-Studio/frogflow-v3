import { describe, expect, it } from "vitest";
import { COURSE_PAGE_CSP, VIDEO_FRAME_HOSTS, videoEmbed } from "./video";

const YT = "dQw4w9WgXcQ";
const RT = "0123456789abcdef0123456789abcdef";

describe("встроенный плеер урока", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://youtu.be/${YT}?t=10`, `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://youtube.com/shorts/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://m.youtube.com/embed/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
    ["https://vimeo.com/123456789", "https://player.vimeo.com/video/123456789"],
    [
      "https://vimeo.com/123456789/abcdef1234",
      "https://player.vimeo.com/video/123456789?h=abcdef1234",
    ],
    [
      "https://player.vimeo.com/video/123456789?h=abcdef1234",
      "https://player.vimeo.com/video/123456789?h=abcdef1234",
    ],
    [
      "https://vk.com/video-22822305_456239018",
      "https://vk.com/video_ext.php?oid=-22822305&id=456239018",
    ],
    ["https://vkvideo.ru/video-1_2", "https://vk.com/video_ext.php?oid=-1&id=2"],
    [`https://rutube.ru/video/${RT}/`, `https://rutube.ru/play/embed/${RT}`],
    ["https://kinescope.io/AbCdEfGh12345678", "https://kinescope.io/embed/AbCdEfGh12345678"],
    ["https://kinescope.io/embed/AbCdEfGh12345678", "https://kinescope.io/embed/AbCdEfGh12345678"],
  ])("%s → плеер", (link, embed) => {
    expect(videoEmbed(link)).toBe(embed);
  });

  it.each([
    `https://youtube.com.evil.ru/watch?v=${YT}`,
    `https://evil.ru/youtube.com/watch?v=${YT}`,
    `https://www.youtube.com.evil.ru/embed/${YT}`,
    `https://youtube.com@evil.ru/watch?v=${YT}`,
    `https://user:pw@www.youtube.com/watch?v=${YT}`,
    `https://www.youtube.com:8443/watch?v=${YT}`,
    `http://www.youtube.com/watch?v=${YT}`,
    `javascript:alert(1)//youtube.com/watch?v=${YT}`,
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    `https://notyoutu.be/${YT}`,
    "https://www.youtube.com/watch?v=short",
    `https://www.youtube.com/watch?v=${YT}"onload="x`,
    `https://www.youtube.com/watch?v=${YT}a`,
    "https://www.youtube.com/channel/UC123",
    "https://vimeo.com/abc",
    "https://vimeo.com/123456789/zzzz",
    "https://vk.com/id123",
    "https://vk.com/video-1_2/extra",
    "https://rutube.ru/video/short/",
    "https://rutube.ru/channel/1/",
    "https://kinescope.io/abc",
    "https://kinescope.io/AbCdEfGh12345678/extra",
    "https://example.com/video.mp4",
    "не ссылка",
    "",
  ])("подделка или чужое: %s → null", (link) => {
    expect(videoEmbed(link)).toBeNull();
  });

  it("все адреса плееров лежат в белом списке frame-src", () => {
    const embeds = [
      `https://youtu.be/${YT}`,
      "https://vimeo.com/123456789",
      "https://vk.com/video-1_2",
      `https://rutube.ru/video/${RT}/`,
      "https://kinescope.io/AbCdEfGh12345678",
    ].map((l) => new URL(videoEmbed(l)!).origin);
    for (const o of embeds) expect(VIDEO_FRAME_HOSTS).toContain(o);
    expect(COURSE_PAGE_CSP).toBe(`frame-src 'self' ${VIDEO_FRAME_HOSTS.join(" ")}`);
  });
});
