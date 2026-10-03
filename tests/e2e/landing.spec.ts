import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Главная, страницы ниш, карта сайта и регистрация: сборка поднимается,
 * страницы рисуются и оживают, серверные функции отвечают. После #30 все
 * /_serverFn на проде отдавали 500, а главная молча прятала кнопку
 * регистрации — модульные тесты при этом были зелёными.
 */

test("главная: страница рисуется, серверная функция отвечает — есть кнопка регистрации", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/");
  await expect(page).toHaveTitle(/FrogFlow/);
  // Кнопка регистрации появляется, только если signupEnabledFn ответила.
  await expect(page.locator('a[href="/signup"]').first()).toBeVisible();
  // Цены из реестра планов: подключение по тарифам, годовая оплата, канал сверх тарифа.
  for (const setup of [/подключение 15\s000/, /подключение 30\s000/, /подключение 60\s000/])
    await expect(page.getByText(setup)).toBeVisible();
  await expect(page.getByText(/2 мес\. в подарок/)).toBeVisible();
  await expect(page.getByText(/5\s000\s₸ в месяц за канал/)).toBeVisible();
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

test("калькулятор тарифа: каналы и годовая оплата меняют цену, кнопка ведёт на регистрацию", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/for/cakes");
  const calc = page.getByTestId("tariff-calc");
  await expect(calc.getByText("Рекомендуем Basic")).toBeVisible();
  await expect(calc.getByText(/^9\s900\s₸ в месяц$/)).toBeVisible();
  // Instagram у кондитерской — с Business, на Basic это доплата 5 000.
  await calc.getByLabel("Instagram").check();
  await expect(calc.getByText(/^14\s900\s₸ в месяц$/)).toBeVisible();
  await expect(calc.getByText(/Доплата за каналы \(Instagram\)/)).toBeVisible();
  await calc.getByLabel(/Годовая оплата/).check();
  await expect(calc.getByText(/в месяц при оплате за год/)).toBeVisible();
  await expect(calc.getByText(/Подключение 15\s000/)).toBeVisible();
  await expect(
    calc.getByRole("link", { name: "Зарегистрироваться с этим тарифом", exact: true }),
  ).toHaveAttribute("href", /\/signup/);
  expect(errors).toEqual([]);
});

test("регистрация открыта: форма на месте", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Открыть магазин" })).toBeVisible();
  await expect(page.locator('input[name="username"]')).toBeVisible();
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
  expect(xml).toContain("https://www.frogflow.tech/blog/telegram-sales-bot</loc>");
  expect(xml).toContain("https://www.frogflow.tech/blog/online-school-bot?lang=uz</loc>");
});

test("статья: заголовок, canonical, смена языка, ссылка из подвала, 404 на чужой адрес", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Бот для продаж в Telegram", exact: true }).first().click();
  await expect(page).toHaveURL(/\/blog\/telegram-sales-bot$/);
  await expect(page).toHaveTitle(/Бот для продаж в Telegram/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://www.frogflow.tech/blog/telegram-sales-bot",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Бот для продаж");
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page).toHaveURL(/\/blog\/telegram-sales-bot\?lang=en$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Telegram sales bot");
  const missing = await page.goto("/blog/unknown");
  expect(missing?.status()).toBe(404);
  expect(errors).toEqual([]);
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
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);
  await page.getByRole("link", { name }).first().click();
  await expect(
    page.getByText("пришёл: метка google/spring · страница «для кондитерских»"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
