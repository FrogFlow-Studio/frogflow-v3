import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Ж1, Ж3, Ж5: новая главная — «Ждёт вас», «Продажи сегодня», «+ Создать» и действия в Ctrl K;
 * по ролям: менеджеру нет «Новой акции», бухгалтеру нет «Создать»; без горизонтальной прокрутки на телефоне.
 */
async function login(page: Page, user: string, password: string) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/** На телефоне меню прячется за кнопкой; на компьютере оно на виду. */
async function openMenu(page: Page) {
  const create = page.getByRole("button", { name: "+ Создать", exact: true }).first();
  const burger = page.getByRole("button", { name: /меню/i }).first();
  // Ждём появления кнопки или меню (страница ещё грузится), а не проверяем один раз сразу после входа.
  await expect(create.or(burger)).toBeVisible();
  if (!(await create.isVisible())) {
    await burger.click();
    await expect(create).toBeVisible();
  }
  return create;
}

test("владелец: «Ждёт вас», продажи сегодня и «+ Создать»", async ({ page }) => {
  const errors = await watch(page);
  await login(page, F.ZH21_SELLER_LOGIN, F.ZH21_SELLER_PASSWORD);

  await expect(page.getByText("Ждёт вас", { exact: true })).toBeVisible();
  // Чек на проверке ведёт сразу в нужную очередь заказов.
  await page
    .getByRole("link", { name: /Чеки на проверке/ })
    .first()
    .click();
  await expect(page).toHaveURL(/status=awaiting_confirmation/);
  await page.goto("/admin");

  await expect(page.getByText("Продажи сегодня", { exact: true })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(false);

  const create = await openMenu(page);
  await create.click();
  await expect(page.getByRole("menuitem", { name: "Новый товар", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Новая акция", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Новый товар", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new/);
  expect(errors).toEqual([]);
});

test("Ctrl K: действия «Создать» без запроса", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "Ctrl K — клавиатура компьютера");
  await login(page, F.ZH21_SELLER_LOGIN, F.ZH21_SELLER_PASSWORD);
  const dialog = page.getByRole("dialog");
  // Окно открывается только после гидрации: до неё нажатие пропадает, поэтому повторяем (как в shop19-a-search).
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 25_000 });
  await expect(page.getByRole("button", { name: /Новая рассылка/ })).toBeVisible();
});

test("менеджеру нет «Новой акции», бухгалтеру нет «+ Создать»", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page, F.ZH21_MANAGER_LOGIN, F.ZH21_MANAGER_PASSWORD);
  const create = await openMenu(page);
  await create.click();
  await expect(page.getByRole("menuitem", { name: "Новый товар", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Новая акция", exact: true })).toHaveCount(0);

  const acc = await browser.newContext({ baseURL });
  const ap = await acc.newPage();
  await login(ap, F.ZH21_ACC_LOGIN, F.ZH21_ACC_PASSWORD);
  await expect(ap.getByRole("button", { name: "+ Создать", exact: true })).toHaveCount(0);
  // Бухгалтер видит только чеки на проверке, без очередей чата и обращений.
  await expect(ap.getByText("Ждёт вас", { exact: true })).toBeVisible();
  expect(await noHorizontalScroll(ap)).toBe(false);
  await acc.close();
});

test("Ж2: узкая колонка — ИИ-баланс владельцу, на телефоне после «Сегодня»", async ({
  page,
}, info) => {
  await login(page, F.ZH21_SELLER_LOGIN, F.ZH21_SELLER_PASSWORD);
  const today = page.getByText("Что сделать сегодня", { exact: true });
  const balance = page.getByRole("link", { name: /Осталось/ });
  await expect(today).toBeVisible();
  await expect(balance).toContainText("$5.00");
  const t = (await today.boundingBox())!;
  const b = (await balance.boundingBox())!;
  if (info.project.name === "phone") {
    // одна колонка: карточка ниже «Сегодня» и не правее неё
    expect(b.y).toBeGreaterThan(t.y);
    expect(Math.abs(b.x - t.x)).toBeLessThan(40);
  } else {
    // две колонки: баланс справа от «Сегодня»
    expect(b.x).toBeGreaterThan(t.x + t.width);
  }
  expect(await noHorizontalScroll(page)).toBe(false);
});

test("Ж2: менеджеру и бухгалтеру ИИ-баланс на главной не показывается", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page, F.ZH21_MANAGER_LOGIN, F.ZH21_MANAGER_PASSWORD);
  await expect(page.getByText("Что сделать сегодня", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Осталось/ })).toHaveCount(0);
  const acc = await browser.newContext({ baseURL });
  const ap = await acc.newPage();
  await login(ap, F.ZH21_ACC_LOGIN, F.ZH21_ACC_PASSWORD);
  await expect(ap.getByText("Ждёт вас", { exact: true })).toBeVisible();
  await expect(ap.getByRole("link", { name: /Осталось/ })).toHaveCount(0);
  await acc.close();
});

test("Ж4: на главной нет «Заказов по статусам», последние заказы — не больше пяти", async ({
  page,
}) => {
  await login(page, F.ZH21_SELLER_LOGIN, F.ZH21_SELLER_PASSWORD);
  await expect(page.getByText("Последние заказы", { exact: true })).toBeVisible();
  await expect(page.getByText("Заказы по статусам", { exact: true })).toHaveCount(0);
  expect(await page.locator("table tbody tr").count()).toBeLessThanOrEqual(5);
  await page.getByRole("link", { name: "все заказы", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/orders/);
});
