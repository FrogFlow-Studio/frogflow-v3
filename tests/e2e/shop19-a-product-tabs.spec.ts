import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** А5: карточка товара вкладками — поля не теряются, обязательное поле открывает свою вкладку, уход с изменениями предупреждает. */
test("карточка товара: вкладки, сохранение и предупреждение", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.ORD19_SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.ORD19_SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/products/new");
  const tabs = page.getByRole("tablist", { name: "Разделы карточки", exact: true });
  for (const n of ["Основное", "Цена и остаток", "Фото", "Варианты"])
    await expect(tabs.getByRole("tab", { name: n, exact: true })).toBeVisible();
  // Без модулей «Наборы» и «Допродажа» этих вкладок нет.
  await expect(tabs.getByRole("tab", { name: "Набор", exact: true })).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Продвижение", exact: true })).toHaveCount(0);

  // Цена — на второй вкладке, название на первой пустое: «Сохранить» возвращает на «Основное».
  await tabs.getByRole("tab", { name: "Цена и остаток", exact: true }).click();
  await page.getByLabel("Базовая цена", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(tabs.getByRole("tab", { name: "Основное", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByLabel("Название", { exact: true }).fill("Товар А5");
  // Тип «физический», чтобы не требовать файл.
  await page.getByLabel("Физический: доставка или самовывоз", { exact: true }).check();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);

  // Цена со скрытой вкладки сохранилась вместе с названием.
  await expect(page.getByRole("heading", { name: "Товар А5", exact: true })).toBeVisible();
  await tabs.getByRole("tab", { name: "Цена и остаток", exact: true }).click();
  await expect(page.getByLabel("Базовая цена", { exact: true })).toHaveValue("1234");

  // Несохранённая правка: уход со страницы спрашивает, «Отмена» оставляет на месте.
  await page.getByLabel("Базовая цена", { exact: true }).fill("999");
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.getByRole("link", { name: "← к списку", exact: true }).click();
  await expect.poll(() => asked).toContain("несохранённые");
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  expect(errors).toEqual([]);
});
