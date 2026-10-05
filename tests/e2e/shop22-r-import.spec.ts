import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Р1: импорт товаров из таблицы: предпросмотр, ошибка строки не мешает остальным, повтор не задваивает. */
test("импорт товаров: предпросмотр, применение и повторная загрузка без дублей", async ({
  page,
}, info) => {
  // База стенда общая для desktop и phone: у каждого проекта свои артикулы и названия.
  const p = info.project.name;
  const errors = await watch(page);
  page.on("dialog", (d) => void d.accept());
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.START22_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.START22_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const csv = [
    "Артикул;Название;Цена",
    `R-1${p};Пробник Р22 ${p};1500`,
    `R-2${p};Набор Р22 ${p};2500`,
    ";Без цены Р22;abc",
  ].join("\n");
  const upload = async () => {
    await page.goto("/admin/products");
    await page.getByRole("button", { name: "Импорт / экспорт", exact: true }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "tovary.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  };

  await upload();
  // Предпросмотр: два товара, строка с неверной ценой названа, ничего ещё не создано.
  await expect(page.getByText("Создать:", { exact: false })).toBeVisible();
  await expect(page.getByText("Не понял цену", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Применить импорт", exact: true }).click();
  await expect(page.getByText("Готово: создано 2, обновлено 0", { exact: false })).toBeVisible();

  await upload();
  await page.getByRole("button", { name: "Применить импорт", exact: true }).click();
  await expect(page.getByText("Готово: создано 0, обновлено 2", { exact: false })).toBeVisible();

  await page.goto("/admin/products");
  await expect(page.locator("a", { hasText: new RegExp(`^Пробник Р22 ${p}$`) })).toHaveCount(1);
  expect(errors).toEqual([]);
});

/** Р1: на телефоне карточка импорта не даёт горизонтальной прокрутки. */
test("импорт товаров на телефоне без горизонтальной прокрутки", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.START22_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.START22_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Импорт / экспорт", exact: true }).click();
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(wide).toBe(false);
});
