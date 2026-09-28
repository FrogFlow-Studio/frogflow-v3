import { createFileRoute } from "@tanstack/react-router";

/**
 * Service worker админки как приложения (PWA): показывает push о заказах
 * (core/push) и по нажатию открывает нужную страницу. Отдаётся маршрутом, а
 * не статикой, — область /admin разрешает заголовок Service-Worker-Allowed.
 */
const SW = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || "FrogFlow", {
    body: d.body || "",
    tag: d.tag,
    icon: "/api/admin/icon",
    badge: "/api/admin/icon",
    data: { url: typeof d.url === "string" && d.url.startsWith("/admin") ? d.url : "/admin" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/admin";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (new URL(c.url).pathname.startsWith("/admin") && "focus" in c) {
        return c.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : w));
      }
    }
    return self.clients.openWindow(url);
  }));
});
`;

export const Route = createFileRoute("/api/admin/sw")({
  server: {
    handlers: {
      GET: () =>
        new Response(SW, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "service-worker-allowed": "/admin",
            "cache-control": "no-cache",
          },
        }),
    },
  },
});
