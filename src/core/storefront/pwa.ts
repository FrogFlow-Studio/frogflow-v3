/**
 * Витрина как приложение на телефоне (В21): service worker, страница «нет сети» и
 * подсказка «Добавить на главный экран» после второго визита. Манифест и иконки —
 * core/storefront/share. Service worker не кеширует ни каталог, ни цены: в кеше
 * лежит только страница «нет сети», поэтому устаревшую цену показать нечем; новая
 * версия кода (PWA_VERSION) заменяет прежний кеш при активации.
 */
export const PWA_VERSION = "1";
/** Подсказку о установке после «Не сейчас» не повторяем столько дней. */
export const INSTALL_SNOOZE_DAYS = 30;
/** С какого визита предлагаем установить. */
export const INSTALL_FROM_VISIT = 2;

const SLUG_RE = /^[a-z0-9_-]{1,64}$/;

/** Адрес страницы «нет сети» магазина. */
export const offlinePath = (slug: string) => `/s/${slug}/offline`;
/** Адрес service worker магазина. Область — `/s/<slug>` (адрес витрины без слэша), заголовок Service-Worker-Allowed это разрешает. */
export const swPath = (slug: string) => `/s/${slug}/sw.js`;

/**
 * Текст service worker. Единственное, что он делает: открытие страницы витрины
 * идёт в сеть, а если сети нет — отдаётся сохранённая страница «нет сети».
 * Картинки, данные и скрипты проходят мимо него, кеша цен нет.
 */
export function swSource(slug: string, version: string = PWA_VERSION): string {
  if (!SLUG_RE.test(slug)) throw new Error("slug");
  const offline = offlinePath(slug);
  return `// FrogFlow витрина ${slug}, версия ${version}
const PREFIX = "ff-offline-${slug}-";
const CACHE = PREFIX + "${version}";
const OFFLINE = ${JSON.stringify(offline)};
const BASE = ${JSON.stringify(`/s/${slug}`)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE, { cache: "reload" }))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  const path = new URL(e.request.url).pathname;
  if (path !== BASE && !path.startsWith(BASE + "/")) return;
  e.respondWith(fetch(e.request, { signal: AbortSignal.timeout(20000) }).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
});
`;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Страница «нет сети»: название магазина, пояснение и «Повторить». Цен и товаров на ней нет. */
export function offlineHtml(o: {
  lang: string;
  name: string;
  title: string;
  text: string;
  retry: string;
  accent: string | null;
}): string {
  const color = /^#[0-9a-f]{6}$/i.test(o.accent ?? "") ? o.accent! : "#2563eb";
  return `<!doctype html>
<html lang="${esc(o.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(o.name)}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px system-ui,sans-serif;background:#fff;color:#111;text-align:center;padding:24px}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px;color:#666}
button{font:inherit;border:0;border-radius:8px;padding:10px 20px;background:${color};color:#fff}
</style>
</head>
<body>
<main>
<h1>${esc(o.name)}</h1>
<p><strong>${esc(o.title)}</strong><br>${esc(o.text)}</p>
<button type="button" onclick="location.reload()">${esc(o.retry)}</button>
</main>
</body>
</html>`;
}

export type InstallMemory = { visits: number; dismissedAt: number | null };

/** Разбор сохранённого в браузере: битое — «первый визит, не отклонял». */
export function parseInstallMemory(raw: string | null | undefined): InstallMemory {
  try {
    const v = JSON.parse(raw ?? "") as Partial<InstallMemory>;
    return {
      visits: Number.isInteger(v.visits) && v.visits! > 0 ? Math.min(v.visits!, 1000) : 0,
      dismissedAt: typeof v.dismissedAt === "number" ? v.dismissedAt : null,
    };
  } catch {
    return { visits: 0, dismissedAt: null };
  }
}

/** Считаем визит один раз за открытие сайта в браузере, а не за каждую страницу. */
export const countVisit = (m: InstallMemory): InstallMemory => ({ ...m, visits: m.visits + 1 });

/**
 * Предлагать ли «Добавить на главный экран»: со второго визита, не в уже установленном
 * приложении и не раньше чем через INSTALL_SNOOZE_DAYS после «Не сейчас».
 */
export function shouldOfferInstall(m: InstallMemory, standalone: boolean, now: number): boolean {
  if (standalone || m.visits < INSTALL_FROM_VISIT) return false;
  if (m.dismissedAt !== null && now - m.dismissedAt < INSTALL_SNOOZE_DAYS * 86_400_000)
    return false;
  return true;
}
