import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Раздел «Перенос» у оператора: статьи базы знаний, оставшиеся от v1 под чужим
 * bot_id, видно в списке и можно перенести клиенту (строка-источник не меняется).
 */
test("перенос базы знаний консультанта: строка v1 видна и переносится клиенту", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);

  await page.goto(`/operator/clients/${F.BOVI_PLAN_ID}?tab=migration`);
  const card = page.locator("section", { hasText: "База знаний консультанта" }).first();
  await expect(
    card.getByRole("heading", { name: "База знаний консультанта", exact: true }),
  ).toBeVisible();
  const row = card.locator("tr", { hasText: F.KB_IMPORT_SOURCE_ID });
  await expect(row).toBeVisible();
  await expect(row).toContainText(F.KB_IMPORT_TITLE);

  await row.getByRole("button", { name: "Перенести статьи в этого клиента", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Перенести статьи базы знаний?", exact: true });
  const go = dialog.getByRole("button", { name: "Перенести статьи", exact: true });
  await expect(go).toBeDisabled();
  await dialog.getByLabel("Название клиента для подтверждения").fill(F.BOVI_PLAN_NAME);
  await go.click();
  await expect(
    card.getByText(/^Перенесено: добавлено \d+, обновлено \d+\. Всего статей у клиента: \d+\.$/),
  ).toBeVisible();
  // Строка-источник осталась на месте со своими тремя статьями.
  await expect(card.locator("tr", { hasText: F.KB_IMPORT_SOURCE_ID })).toContainText(
    F.KB_IMPORT_TITLE,
  );
  expect(errors).toEqual([]);
});
