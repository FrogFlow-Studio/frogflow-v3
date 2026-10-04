import { expect, test } from "@playwright/test";

/**
 * Публичная страница /status: каналы, оплата и витрина отдельными строками,
 * на четырёх языках, без входа и без данных клиентов. База подставная.
 */
test("страница статуса открывается без входа и переключает язык", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const name of ["Боты Telegram", "Instagram", "WhatsApp", "Витрины и панели"])
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page.getByText("Telegram bots", { exact: true })).toBeVisible();
  await expect(page.getByText("Storefronts and panels", { exact: true })).toBeVisible();
});
