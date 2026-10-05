import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Т1, Т2, Т4: карточка товара одной страницей, оглавление, готовность, панель «Сохранить / Отменить». */
test("карточка товара одной страницей: оглавление, готовность, панель сохранения", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.PRODUCT21_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.PRODUCT21_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/products/new");
  // Вкладок нет, оглавление есть, все разделы на одной странице.
  await expect(page.getByRole("tablist")).toHaveCount(0);
  const toc = page.getByRole("navigation", { name: "Разделы карточки", exact: true });
  for (const n of ["Основное", "Фото", "Цена", "Склад", "Варианты"])
    await expect(toc.getByRole("link", { name: n, exact: true })).toBeVisible();
  await expect(page.locator("#sec-price")).toBeVisible();
  await expect(page.locator("#sec-stock")).toBeVisible();
  await expect(page.getByLabel("Базовая цена", { exact: true })).toBeVisible();

  // Готовность: пока ничего не заполнено, не хватает названия и цены.
  const ready = page.getByTestId("product-readiness");
  await expect(ready).toContainText("Не хватает");
  await expect(ready).toContainText("название");
  await expect(ready).toContainText("цена");

  // Правка включает отметку «есть несохранённые изменения».
  const bar = page.getByTestId("product-savebar");
  await expect(bar).toContainText("Все изменения сохранены");
  await page.getByLabel("Название", { exact: true }).fill("Товар Т21");
  await expect(bar).toContainText("Есть несохранённые изменения");
  await page.getByLabel("Базовая цена", { exact: true }).fill("2500");
  await expect(ready).not.toContainText("название");
  await expect(ready).not.toContainText("цена");

  // «Отменить» возвращает форму к сохранённому.
  page.once("dialog", (d) => void d.accept());
  await bar.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(page.getByLabel("Название", { exact: true })).toHaveValue("");

  // Сохранение отправляет те же поля, что и раньше: цена и название доходят.
  await page.getByLabel("Название", { exact: true }).fill("Товар Т21");
  await page.getByLabel("Базовая цена", { exact: true }).fill("2500");
  await page.getByLabel("Физический: доставка или самовывоз", { exact: true }).check();
  await bar.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Товар Т21", exact: true })).toBeVisible();
  await expect(page.getByLabel("Базовая цена", { exact: true })).toHaveValue("2500");
  await expect(bar).toContainText("Все изменения сохранены");
  // Склад — отдельный раздел; остаток и цена пишутся одной формой, не мешая друг другу.
  await page.getByLabel("Остаток", { exact: true }).fill("7");
  await bar.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(bar).toContainText("Все изменения сохранены");
  await page.reload();
  await expect(page.getByLabel("Остаток", { exact: true })).toHaveValue("7");
  await expect(page.getByLabel("Базовая цена", { exact: true })).toHaveValue("2500");
  // Набор — раздел, потому что у магазина включён модуль наборов; у сохранённого физического товара он есть.
  await expect(toc.getByRole("link", { name: "Набор", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("карточка товара на телефоне: одна колонка, без горизонтальной прокрутки", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.PRODUCT21_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.PRODUCT21_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/products/new");
  await expect(page.getByTestId("product-savebar")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("список товаров показывает готовность и остаток", async ({ page }) => {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.PRODUCT21_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.PRODUCT21_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/products");
  await expect(page.getByRole("columnheader", { name: "Готовность", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Остаток", exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: F.PRODUCT21_ITEM_NAME });
  await expect(row).toContainText("Не хватает");
  await expect(row).toContainText("описание");
  await expect(row).toContainText("категория");
  await expect(row).toContainText("5");
  // Поиск по названию остаётся.
  await page.getByPlaceholder("Поиск по названию", { exact: true }).fill("нет такого товара");
  await page.keyboard.press("Enter");
  await expect(page.getByText(F.PRODUCT21_ITEM_NAME)).toHaveCount(0);
});
