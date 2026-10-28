import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Ч9: оператор ведёт обращение — статус, метка, заметка; продавец заметку не видит. */
async function sellerLogin(page: Page) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function operatorLogin(page: Page) {
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);
}

test("поддержка: статус, метка и заметка оператора; заметки продавец не видит", async ({
  browser,
}, info) => {
  // Два проекта идут на одной базе: у каждого своя метка и своя заметка.
  const stamp = `${info.project.name}${Date.now()}`;
  const question = `Вопрос по оплате ${stamp}`;
  const label = `метка${stamp}`.slice(0, 30);
  const note = `ВНУТРЕННЯЯ ЗАМЕТКА ${stamp}`;

  const sellerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  const sellerErrors = await watch(seller);
  await sellerLogin(seller);
  await seller.goto("/admin/support");
  await seller.getByRole("textbox", { name: "Опишите вопрос или проблему" }).fill(question);
  await seller.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(seller.getByText(question, { exact: true })).toBeVisible();

  const opCtx = await browser.newContext();
  const op = await opCtx.newPage();
  const opErrors = await watch(op);
  await operatorLogin(op);
  await op.goto("/operator/support");
  await op.getByRole("link", { name: new RegExp(F.SHOP_NAME) }).click();
  await expect(op.getByText(question, { exact: true })).toBeVisible();

  await op.getByText("Статус, метки и внутренняя заметка", { exact: true }).click();

  // Статус: «в работе». Второй проект ставит его на том же обращении одновременно: оба
  // видят «не нажата», оба жмут, и второй клик снимает статус. Жмём, пока не встанет.
  const work = op.getByRole("button", { name: "в работе", exact: true });
  await expect(async () => {
    if ((await work.getAttribute("aria-pressed")) !== "true") await work.click();
    await expect(work).toHaveAttribute("aria-pressed", "true", { timeout: 2000 });
  }).toPass({ timeout: 15_000 });

  // Своя метка: появляется кнопкой и чипом-фильтром.
  await op.getByRole("textbox", { name: "Своя метка", exact: true }).fill(label);
  await op.getByRole("textbox", { name: "Своя метка", exact: true }).press("Enter");
  await expect(op.getByRole("button", { name: `#${label}`, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Заметка сохраняется и переживает перезагрузку.
  await op.getByRole("textbox", { name: "Заметка оператора (продавец её не видит)" }).fill(note);
  await op.getByRole("button", { name: "Сохранить заметку", exact: true }).click();
  await op.reload();
  await op.getByText("Статус, метки и внутренняя заметка", { exact: true }).click();
  await expect(
    op.getByRole("textbox", { name: "Заметка оператора (продавец её не видит)" }),
  ).toHaveValue(note);

  // Продавец заметку и метку не видит.
  await seller.reload();
  await expect(seller.getByText(question, { exact: true })).toBeVisible();
  await expect(seller.getByText(note)).toHaveCount(0);
  await expect(seller.getByText(label)).toHaveCount(0);
  expect(sellerErrors).toEqual([]);
  expect(opErrors).toEqual([]);
  await sellerCtx.close();
  await opCtx.close();
});
