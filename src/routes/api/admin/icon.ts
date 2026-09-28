import { createFileRoute } from "@tanstack/react-router";

/** Значок приложения админки: зелёный квадрат с лягушкой-буквами FF (SVG, любой размер). */
const icon = (maskable: boolean) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="#16a34a"/>
<text x="256" y="318" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="200" font-weight="700" fill="#ffffff">FF</text>
</svg>`;

export const Route = createFileRoute("/api/admin/icon")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(icon(new URL(request.url).searchParams.has("maskable")), {
          headers: {
            "content-type": "image/svg+xml",
            "cache-control": "public, max-age=86400",
          },
        }),
    },
  },
});
