import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * «Открыть свой магазин» (В19): заявка с публичной страницы становится лидом, оператор
 * одной кнопкой создаёт магазин и получает готовое сообщение заявителю.
 */
async function operatorLogin(page: Page) {
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);
}

test("заявка со страницы площадки доходит до оператора, магазин создаётся одной кнопкой", async ({
  browser,
}, info) => {
  // Два проекта (desktop и phone) идут на одной базе: у каждого свой магазин и телефон.
  const name = `Заявка Лавка ${info.project.name} ${Date.now()}`;
  const phone = `7700${String(Date.now()).slice(-7)}`;

  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  const errors = await watch(visitor);
  await visitor.goto("/market/open?lang=en");
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText("Open your own shop");
  await visitor.getByRole("radio", { name: "Bakery", exact: true }).check();
  await visitor.getByRole("radio", { name: /^Pro/ }).check();
  await visitor.getByLabel("Shop name", { exact: true }).fill(name);
  await visitor.getByLabel("Phone (WhatsApp)", { exact: true }).fill(`+${phone}`);
  await visitor.getByLabel("City", { exact: true }).fill("Almaty");
  // Задача против ботов принимает ответ не раньше чем через 3 секунды после загрузки страницы.
  await visitor.waitForTimeout(3500);
  await visitor.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(visitor.getByText("Request received", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
  await visitorCtx.close();

  const opCtx = await browser.newContext();
  const op = await opCtx.newPage();
  await operatorLogin(op);
  await op.goto("/operator/leads");
  // Карточка именно этого лида: второй проект создаёт свой на той же базе.
  const card = op
    .getByText(name)
    .first()
    .locator("xpath=ancestor::*[.//button[normalize-space()='Создать магазин']][1]");
  op.once("dialog", (d) => void d.accept());
  await card.getByRole("button", { name: "Создать магазин", exact: true }).click();
  // Сообщение именно этого магазина: в нём его название.
  const text = op
    .getByRole("textbox", { name: "Сообщение заявителю", exact: true })
    .filter({ hasText: name });
  await expect(text).toBeVisible({ timeout: 30_000 });
  await expect(text).toHaveValue(/shop-[0-9a-f]{8}/);
  await expect(text).toHaveValue(/Password: /);
  await opCtx.close();
});
