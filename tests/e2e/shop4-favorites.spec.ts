import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Избранное на сайте: «♡» на карточке и странице товара, страница «Избранное»,
 * удаление. Список лежит в браузере; исчезнувший товар тихо убирается.
 */
test("избранное: добавить с карточки, открыть страницу, удалить", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}`);
  await page.getByRole("button", { name: "В избранное", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Убрать из избранного", exact: true })).toHaveCount(
    1,
  );

  await page.getByRole("link", { name: "Избранное", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${F.SHOP_SLUG}/favorites$`));
  await expect(page.getByRole("heading", { name: "Избранное", exact: true })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(1);

  // Список пережил перезагрузку: он в браузере.
  await page.reload();
  await expect(page.locator("article")).toHaveCount(1);

  await page.getByRole("button", { name: "Убрать из избранного", exact: true }).click();
  await expect(page.getByText("В избранном пока пусто", { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test("избранное: с карточки товара; исчезнувшие товары убираются тихо", async ({ page }) => {
  const errors = await watch(page);
  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`);
  await page.getByRole("button", { name: "В избранное", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Убрать из избранного", exact: true }),
  ).toBeVisible();

  // Рядом с живым товаром в браузере лежит id, которого в магазине нет.
  const ghost = "e2e00000-0000-4000-8000-0000000000ff";
  await page.evaluate(
    ([slug, live, gone]) => localStorage.setItem(`ff-fav-${slug}`, JSON.stringify([gone, live])),
    [F.SHOP_SLUG, F.PRODUCT_ID, ghost] as const,
  );
  await page.goto(`/s/${F.SHOP_SLUG}/favorites`);
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.getByText(F.PRODUCT_NAME).first()).toBeVisible();
  await expect
    .poll(() => page.evaluate((slug) => localStorage.getItem(`ff-fav-${slug}`), F.SHOP_SLUG))
    .toBe(JSON.stringify([F.PRODUCT_ID]));
  expect(errors).toEqual([]);
});

test("избранное: «Открыть в Telegram» ведёт в бота с токеном переноса", async ({ page }) => {
  const errors = await watch(page);
  // Переход на t.me перехватываем: проверяем только адрес.
  let target = "";
  await page.route("https://t.me/**", async (route) => {
    target = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" });
  });
  await page.goto(`/s/${F.SHOP_SLUG}/p/${F.PRODUCT_ID}`);
  await page.getByRole("button", { name: "В избранное", exact: true }).click();
  await page.goto(`/s/${F.SHOP_SLUG}/favorites`);
  await expect(page.locator("article")).toHaveCount(1);

  await page.getByRole("button", { name: "Открыть в Telegram", exact: true }).click();
  await expect.poll(() => target).toMatch(/^https:\/\/t\.me\/e2e_shop_bot\?start=wc_[0-9a-f]{32}$/);
  expect(errors).toEqual([]);
});
