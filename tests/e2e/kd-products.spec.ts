import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Пожелания Кристины Дидактика: «сначала новые», «нет на KZ» и поиск по коду в ключевых словах. */
const names = (page: Page) =>
  page.locator("table tbody tr td a[href*='/admin/products/']").allTextContents();

test("товары: сначала новые, фильтр «нет на KZ», поиск по ключевым словам", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "отдельный магазин: достаточно одного прогона");
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.KDP_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.KDP_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/products");
  await expect.poll(() => names(page)).toEqual(["Азбука КД", "Буквы КД", "Слоги КД", "Пенал КД"]);

  await page.getByLabel("Порядок", { exact: true }).selectOption("new");
  await expect(page).toHaveURL(/sort=new/);
  await expect.poll(() => names(page)).toEqual(["Пенал КД", "Слоги КД", "Буквы КД", "Азбука КД"]);

  // Выбор запомнен: пустой адрес снова открывается «сначала новые».
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/sort=new/);

  // Казахский файл v1 в старом поле — «есть», физический товар — не «перевести».
  await page.getByLabel("Язык материалов", { exact: true }).selectOption("-kk");
  await expect.poll(() => names(page)).toEqual(["Слоги КД"]);
  await page.getByLabel("Язык материалов", { exact: true }).selectOption("kk");
  await expect.poll(() => names(page)).toEqual(["Буквы КД", "Азбука КД"]);
  await page.getByLabel("Язык материалов", { exact: true }).selectOption("");

  await page.getByPlaceholder("Название или ключевые слова", { exact: true }).fill(F.KDP_CODE);
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect.poll(() => names(page)).toEqual(["Слоги КД"]);
  expect(errors).toEqual([]);
});
