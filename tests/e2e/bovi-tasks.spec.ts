import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * «Прайс консультанта»: задачи консультанта (каждая передача менеджеру),
 * образ консультанта и рабочие часы — то, что правит сам продавец.
 */
async function login(page: Page) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.BOVI_E2E_LOGIN);
  await page.locator('input[name="password"]').fill(F.BOVI_E2E_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("задачи консультанта: передача видна с товарами и отмечается сделанной", async ({ page }) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/pricelist");
  const card = page.locator("section", { hasText: "Задачи консультанта" });
  await expect(card.getByText("Готов купить", { exact: true })).toBeVisible();
  await expect(card.getByText(F.BOVI_E2E_TASK_CUSTOMER, { exact: true })).toBeVisible();
  await expect(card.getByText(F.BOVI_E2E_TASK_SUMMARY, { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: "Открыть диалог", exact: true })).toHaveAttribute(
    "href",
    "https://ig.me/m/e2e_bovi_client",
  );
  // База у прогонов общая: сначала приводим задачу в «не разобрано».
  const undo = card.getByRole("button", { name: "Вернуть в работу", exact: true });
  const done = card.getByRole("button", { name: "Сделано", exact: true });
  if (await undo.isVisible()) await undo.click();
  await expect(done).toBeVisible();
  await expect(card.getByText("Не разобрано: 1", { exact: true })).toBeVisible();
  await done.click();
  await expect(undo).toBeVisible();
  await expect(card.getByText("Не разобрано: 0", { exact: true })).toBeVisible();
  // Возвращаем как было, чтобы следующий прогон видел то же самое.
  await undo.click();
  await expect(done).toBeVisible();
  expect(errors).toEqual([]);
});

test("образ консультанта и рабочие часы: стандартный текст BOVI в форме", async ({ page }) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/pricelist");
  const persona = page.locator("section", { hasText: "Образ консультанта" });
  await expect(persona.getByLabel("Название магазина", { exact: true })).toHaveValue("BOVI");
  await expect(
    persona.getByText("Сейчас стандартный текст — консультант отвечает как раньше.", {
      exact: true,
    }),
  ).toBeVisible();
  const settings = page.locator("section", { hasText: "Марки, сайт и бутик" });
  await expect(settings.getByLabel("Открытие", { exact: true })).toHaveValue("10");
  await expect(settings.getByLabel("Закрытие", { exact: true })).toHaveValue("21");
  await expect(
    settings.getByText(
      "Консультант считает нерабочим время с 21:00 до 10:00 — тогда он говорит, что менеджер ответит утром.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
