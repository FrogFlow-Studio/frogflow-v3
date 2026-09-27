import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures";

/**
 * Сквозной прогон собранного приложения в браузере. Ловит то, чего не видят
 * модульные тесты: сборка поднимается, страницы рисуются и оживают, серверные
 * функции отвечают. После #30 все /_serverFn на проде отдавали 500, а главная
 * молча прятала кнопку регистрации — модульные тесты при этом были зелёными.
 */

/** Ошибки страницы и внешние запросы: шрифты и telegram.org в CI не нужны. */
async function watch(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  return errors;
}

test("главная: страница рисуется, серверная функция отвечает — есть кнопка регистрации", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/");
  await expect(page).toHaveTitle(/FrogFlow/);
  // Кнопка регистрации появляется, только если signupEnabledFn ответила.
  await expect(page.locator('a[href="/signup"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("страница ниши: свой заголовок и canonical, тарифы ниши, переход с главной", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Для кондитерских" }).first().click();
  await expect(page).toHaveURL(/\/for\/cakes$/);
  await expect(page).toHaveTitle(/Бот для кондитерской/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://www.frogflow.tech/for/cakes",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText("торты");
  // Тарифы только этой ниши: без вкладок, со строкой кондитерской.
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByText("Задаток и ручной заказ")).toBeVisible();
  await page.getByRole("link", { name: "KZ" }).click();
  await expect(page).toHaveURL(/\/for\/cakes\?lang=kk$/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://www.frogflow.tech/for/cakes?lang=kk",
  );
  const missing = await page.goto("/for/unknown");
  expect(missing?.status()).toBe(404);
  expect(errors).toEqual([]);
});

test("вход продавца: неверный пароль — понятная фраза, а не сырой текст ошибки", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Вход в панель магазина" })).toBeVisible();
  await page.locator('input[name="username"]').fill("nobody");
  await page.locator('input[name="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText("Неверный логин или пароль")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /Cannot read|undefined|TypeError|Internal Server Error/,
  );
  expect(errors).toEqual([]);
});

test("панели без входа уводят на страницу входа", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin/pipeline");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/operator");
  await expect(page).toHaveURL(/\/operator\/login$/);
  expect(errors).toEqual([]);
});

test("регистрация открыта: форма на месте", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Открыть магазин" })).toBeVisible();
  await expect(page.locator('input[name="username"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("витрина: неизвестный магазин — страница «Магазин не найден»", async ({ page }) => {
  const errors = await watch(page);
  const res = await page.goto("/s/net-takogo-magazina");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Магазин не найден" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("витрина: превью ссылки и установка на телефон", async ({ page, request }) => {
  const errors = await watch(page);
  // Мессенджеры не выполняют скрипты: теги должны быть уже в ответе сервера.
  const html = await (await request.get(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`)).text();
  expect(html).toMatch(/<meta property="og:image" content="https?:\/\/[^"]+\/api\/img\//);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  const og = (p: string) => page.locator(`meta[property="${p}"]`).getAttribute("content");
  expect(await og("og:title")).toBe(F.SHOP_NAME);
  expect(await og("og:url")).toMatch(new RegExp(`^https?://[^/]+/s/${F.SHOP_SLUG}$`));
  expect(await og("og:image")).toMatch(new RegExp(`^https?://[^/]+/api/img/${F.SHOP_ID}/`));
  const manifest = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifest).toBe(`/s/${F.SHOP_SLUG}/manifest.webmanifest`);
  const m = await request.get(manifest!);
  expect(m.headers()["content-type"]).toContain("application/manifest+json");
  expect(await m.json()).toMatchObject({ name: F.SHOP_NAME, display: "standalone" });
  const icon = await request.get(`/s/${F.SHOP_SLUG}/icon/192`);
  expect(icon.headers()["content-type"]).toBe("image/png");
  expect((await request.get(`/s/net-takogo-magazina/manifest.webmanifest`)).status()).toBe(404);

  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`);
  expect(await og("og:title")).toBe(`${F.PRODUCT_NAME} — ${F.SHOP_NAME}`);
  expect(await og("og:type")).toBe("product");
  expect(errors).toEqual([]);
});

test("витрина: на странице товара только одобренные отзывы", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`);
  await expect(page.getByRole("heading", { name: "Отзывы покупателей" })).toBeVisible();
  await expect(page.getByText("Ребёнок пишет с удовольствием")).toBeVisible();
  await expect(page.getByText("Неодобренный отзыв")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("маршруты /api отвечают: крон без секрета — 401, а не 500", async ({ request }) => {
  expect((await request.get("/api/cron/health")).status()).toBe(401);
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await request.get("/robots.txt")).status()).toBe(200);
});

test("предпросмотр бота: приветствие, карточка товара и меню", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/bot-preview");
  await expect(page.getByRole("heading", { name: "Предпросмотр бота" })).toBeVisible();
  await expect(page.locator("strong", { hasText: F.SHOP_NAME })).toBeVisible();
  await expect(page.locator("strong", { hasText: F.PRODUCT_NAME })).toBeVisible();
  await expect(page.getByText("📚 Каталог")).toBeVisible();
  expect(errors).toEqual([]);
});

test("настройки продавца: разделы рисуются и оживают без ошибок гидратации", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/settings");
  // Разделы, которые видны на тарифе e2e-магазина (остальные — по модулям).
  for (const title of [
    "Магазин",
    "Способы оплаты по странам",
    "Telegram-бот",
    "Физические товары: получение и оплата",
    "Зоны доставки",
    "Robokassa: оплата картой",
    "Недельный отчёт",
    "Защита PDF от перепродажи",
  ])
    await expect(page.getByText(title, { exact: true }).first(), title).toBeVisible();
  await expect(page.getByText(`/api/robokassa/${F.SHOP_ID}/result`)).toContainText("http");
  await expect(page.locator("body")).not.toContainText(
    /Cannot read|undefined|TypeError|Internal Server Error/,
  );
  expect(errors).toEqual([]);
});

test("витрина: разметка товара для поиска уже в ответе сервера", async ({ request }) => {
  const html = await (await request.get(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`)).text();
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  expect(canonical).toMatch(new RegExp(`^https?://[^/]+/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}$`));
  const raw = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1];
  const ld = JSON.parse(raw!);
  expect(ld).toMatchObject({
    "@type": "Product",
    name: F.PRODUCT_NAME,
    offers: { price: String(F.PRODUCT_PRICE), availability: "https://schema.org/InStock" },
    // Второй отзыв (1 звезда) ещё не одобрен продавцом и в оценку не входит.
    aggregateRating: { ratingValue: 5, reviewCount: 1 },
  });
  const shopHtml = await (await request.get(`/s/${F.SHOP_SLUG}?sort=new`)).text();
  expect(shopHtml).toMatch(
    new RegExp(`<link rel="canonical" href="https?://[^/]+/s/${F.SHOP_SLUG}"`),
  );
});

test("аналитика: воронка по источникам рисуется", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/analytics");
  await expect(page.getByText("Воронка по источникам")).toBeVisible();
  expect(errors).toEqual([]);
});

test("карта сайта платформы: в индексе есть карта страниц, в ней главная и ниши", async ({
  request,
}) => {
  const index = await (await request.get("/sitemap.xml")).text();
  expect(index).toContain("/sitemap-pages.xml</loc>");
  const pages = await request.get("/sitemap-pages.xml");
  expect(pages.status()).toBe(200);
  const xml = await pages.text();
  expect(xml).toContain("https://www.frogflow.tech/for/cakes</loc>");
  expect(xml).toContain("https://www.frogflow.tech/?lang=kk</loc>");
});

test("регистрация со страницы ниши: ниша выбрана, метки видны оператору", async ({
  page,
}, info) => {
  const errors = await watch(page);
  const login = `e2e${Date.now()}${info.project.name[0]}`;
  const name = `Кондитерская ${login}`;
  await page.goto("/for/cakes?utm_source=google&utm_campaign=spring");
  await page
    .getByRole("link", { name: /бесплатно/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/signup\?.*vertical=confectionery/);
  await expect(page.locator('select[name="vertical"]')).toHaveValue("confectionery");
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="username"]').fill(login);
  await page.locator('input[name="password"]').fill("e2e-password-123");
  // Защита от ботов не принимает форму быстрее 3 секунд (CHALLENGE_MIN_FILL_MS).
  await page.waitForTimeout(3_100);
  await page.getByRole("button", { name: "Создать магазин" }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/operator$/);
  await page.getByRole("link", { name }).first().click();
  await expect(
    page.getByText("пришёл: метка google/spring · страница «для кондитерских»"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("витрина: вторая страница каталога открывается ссылкой без JS, со своим canonical", async ({
  request,
}) => {
  const html = await (await request.get(`/s/${F.SHOP_SLUG}?page=2`)).text();
  expect(html).toMatch(
    new RegExp(`<link rel="canonical" href="https?://[^/]+/s/${F.SHOP_SLUG}\\?page=2"`),
  );
  // Товаров на второй странице нет (в магазине один), зато есть путь к началу.
  expect(html).toContain("К началу каталога");
  expect(html).not.toContain(F.PRODUCT_NAME);
});
