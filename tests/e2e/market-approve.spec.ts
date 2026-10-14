import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Площадка: оператор включает магазин по согласию продавца, полученному в переписке. Без
 * записи «как получено согласие» кнопка не нажимается; после неё магазин одобрен и в
 * настройках клиента — согласие, одобрение и прежние ключи.
 */
const S = F.MA_SHOP;

test("оператор включает магазин на площадке по согласию продавца", async ({ page, request }) => {
  test.skip(test.info().project.name === "phone", "одна запись на прогон: хватает компьютера");
  const errors = await watch(page);
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);

  await page.goto(`/operator/clients/${S.id}`);
  await expect(
    page.getByText("Магазин не давал согласия на площадку (или не на v2).", { exact: true }),
  ).toBeVisible();
  const on = page.getByRole("button", {
    name: "Показать на площадке (продавец согласен)",
    exact: true,
  });
  await expect(on).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Как получено согласие продавца", exact: true })
    .fill("Владелец, Telegram, 14.10");
  await on.click();
  await expect(
    page.getByText("Согласие есть и магазин одобрен: показывается на площадке.", { exact: true }),
  ).toBeVisible();

  const bots = (await (await request.get(`${F.STUB}/__e2e/tables/bots`)).json()) as {
    id: string;
    settings: Record<string, unknown>;
  }[];
  const bot = bots.find((b) => b.id === S.id)!;
  expect(bot.settings.marketplace).toEqual({ listed: true, approved: true });
  expect(bot.settings.slug).toBe(S.slug);
  expect(errors).toEqual([]);
});
