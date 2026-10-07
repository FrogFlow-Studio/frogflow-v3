import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * «Прайс консультанта»: статьи базы знаний из вставленного текста —
 * предпросмотр, отметка, добавление; прежние статьи остаются. Таблица
 * Google — форма на месте (скачивание проверяют модульные тесты: в e2e
 * сети нет).
 */
async function login(page: Page) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.BOVI_PLAN_LOGIN);
  await page.locator('input[name="password"]').fill(F.BOVI_PLAN_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("база знаний: текст → предпросмотр → в базу только отмеченные", async ({ page }, info) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/pricelist");
  await expect(page.getByText("Прайс из Google Таблицы", { exact: true })).toBeVisible();

  // Заголовки свои на каждый прогон: проекты desktop и phone идут по одной базе.
  const tag = `${info.project.name}-${Date.now()}`;
  const keep = `Доставка ${tag}`;
  const skip = `Черновик ${tag}`;
  const titleInput = (title: string) =>
    page.getByLabel("Заголовок", { exact: true }).and(page.locator(`[value="${title}"]`));

  await page
    .getByLabel("Или вставьте текст", { exact: true })
    .fill(`### ${keep}\nТеги: доставка\nПо Алматы — бесплатно.\n---\n### ${skip}\nНе нужен.`);
  await page.getByRole("button", { name: "Показать статьи", exact: true }).click();
  await expect(page.getByText("Найдено статей: 2. Отметьте, какие добавить.")).toBeVisible();
  // Предпросмотр ничего не сохранил.
  await expect(titleInput(keep)).toHaveCount(0);

  await page.getByRole("checkbox", { name: new RegExp(skip) }).uncheck();
  await page.getByRole("button", { name: "Добавить в базу (1)", exact: true }).click();
  await expect(page.getByText(/^Добавлено 1, обновлено 0\. Всего статей: \d+\.$/)).toBeVisible();

  // Список статей ниже обновился из базы: новая есть, неотмеченной нет.
  await expect(titleInput(keep)).toHaveCount(1);
  await expect(titleInput(skip)).toHaveCount(0);
  expect(errors).toEqual([]);
});
