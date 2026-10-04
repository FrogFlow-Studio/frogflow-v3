import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Страница «Комиссия» у продавца: правило, что не облагается, и честное «пока не начисляется» при выключенном выключателе. */
test("комиссия: страница объясняет правило и что заказы ботов не облагаются", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/commission");
  await expect(
    page.getByRole("heading", { name: "Комиссия платформы", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("commission-bots")).toContainText(
    "Заказы из ботов Telegram, Instagram и WhatsApp не облагаются.",
  );
  // Общий выключатель по умолчанию выключен: комиссия не начисляется.
  await expect(page.getByTestId("commission-off")).toContainText("Комиссия пока не начисляется.");
  await expect(page.getByText("Этот месяц", { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
