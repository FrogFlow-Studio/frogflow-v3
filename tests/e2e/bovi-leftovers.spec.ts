import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * BOVI 08.10, партия 4: консультант без продаж (модули магазина из v1, товаров
 * нет) видел в админке остатки магазина — баллы и заказы покупателей,
 * «Спасибо за заказ», карточку товара в предпросмотре, брошенную корзину в
 * рассылках, «Только по заказам» у автоответчика. Продающий магазин видит
 * всё как раньше.
 */
async function login(page: Page, user: string, password: string) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

const consultant = (page: Page) => login(page, F.BOVI_LEFT_LOGIN, F.BOVI_LEFT_PASSWORD);

test("консультант без продаж: покупатели без баллов, покупок и заказов", async ({ page }) => {
  const errors = await watch(page);
  await consultant(page);
  await page.goto("/admin/customers");
  const row = page.getByRole("link", { name: F.BOVI_LEFT_BUYER_NAME, exact: true });
  await expect(row).toBeVisible();
  await expect(page.locator("thead").getByText("Канал", { exact: true })).toBeVisible();
  await expect(page.locator("thead").getByText("Баллы", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Сегменты покупателей", exact: true })).toHaveCount(
    0,
  );
  await row.click();
  await expect(page.getByText("Последний ответ консультанта", { exact: true })).toBeVisible();
  for (const x of ["Баллы", "Покупки", "Заказы", "Заказов пока нет.", "Правка баллов"])
    await expect(page.locator("main").getByText(x, { exact: true }), x).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("консультант без продаж: тексты бота без «Спасибо за заказ», часы — только Telegram", async ({
  page,
}) => {
  const errors = await watch(page);
  await consultant(page);
  await page.goto("/admin/bot-texts");
  await expect(page.getByText("Приветствие", { exact: true })).toBeVisible();
  await expect(page.getByText("Спасибо за заказ", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Только для Telegram-бота/)).toBeVisible();
  await expect(
    page.locator("main").getByRole("link", { name: /^Рабочие часы консультанта/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Instagram", exact: true }).click();
  await expect(page.getByText(/отвечает ИИ-консультант своими словами/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Открыть настройки консультанта", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/пока не подключены/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("консультант без продаж: предпросмотр без карточки товара, ведёт в тест-чат", async ({
  page,
}) => {
  const errors = await watch(page);
  await consultant(page);
  await page.goto("/admin/bot-preview");
  await expect(page.getByText("Покупатель нажимает «Старт»", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Открыть тест-чат консультанта", exact: true }),
  ).toHaveAttribute("href", "/admin/consultant");
  for (const x of [
    "Товар для карточки",
    "Покупатель открывает товар",
    "В каталоге нет активных товаров, карточку показать не на чем.",
  ])
    await expect(page.getByText(x, { exact: true }), x).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("консультант без продаж: рассылки без корзины, возврата и аудиторий по покупкам", async ({
  page,
}) => {
  const errors = await watch(page);
  await consultant(page);
  await page.goto("/admin/broadcasts");
  await expect(page.getByText("Всем", { exact: true })).toBeVisible();
  for (const x of [
    "Напоминание о брошенной корзине",
    "Возвратные продажи",
    "Покупателям",
    "Ещё не покупали",
  ])
    await expect(page.getByText(x, { exact: true }), x).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("консультант без продаж: «Уведомления» говорят, где передачи менеджеру", async ({ page }) => {
  const errors = await watch(page);
  await consultant(page);
  await page.goto("/admin/notifications");
  await expect(page.getByText(/у консультанта без продаж их нет/)).toBeVisible();
  await expect(page.getByText(/попадает и в задачи консультанта/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("консультант без продаж: автоответчик Instagram без «Только по заказам»", async ({ page }) => {
  const errors = await watch(page);
  await consultant(page);
  await page.goto("/admin/settings#dbot-instagram");
  const card = page.locator("section.card", { hasText: "Автоответчик · Instagram" });
  await expect(card.getByText(/Покупателям в этом канале отвечает ИИ-консультант/)).toBeVisible();
  // Пауза после ответа руками действует (модуль магазина в Direct включён) — остаётся.
  await expect(
    card.getByText("Пауза бота после вашего ответа руками", { exact: true }),
  ).toBeVisible();
  for (const x of ["На что отвечать", "Только по заказам", "Что доступно в переписке"])
    await expect(card.getByText(x, { exact: true }), x).toHaveCount(0);
  await expect(card.getByRole("switch")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("продающий магазин: баллы, заказы, «Спасибо за заказ» и карточка товара на месте", async ({
  page,
}) => {
  const errors = await watch(page);
  await login(page, F.SELLER_LOGIN, F.SELLER_PASSWORD);
  await page.goto("/admin/customers");
  await expect(page.locator("thead").getByText("Баллы", { exact: true })).toBeVisible();
  await page.goto("/admin/customers/telegram:e2e-panel");
  await expect(page.getByRole("heading", { name: "Покупки", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Заказы", exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("Баллы", { exact: true })).toBeVisible();
  await page.goto("/admin/bot-texts");
  await expect(page.getByText("Спасибо за заказ", { exact: true })).toBeVisible();
  await expect(page.getByText(/^По часовому поясу магазина/)).toBeVisible();
  await page.goto("/admin/bot-preview");
  await expect(page.getByText("Товар для карточки", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Открыть тест-чат консультанта", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("продающий магазин: в рассылках корзина, возврат и аудитории по покупкам", async ({
  page,
}) => {
  const errors = await watch(page);
  await login(page, F.AUTO16_SELLER_LOGIN, F.AUTO16_SELLER_PASSWORD);
  await page.goto("/admin/broadcasts");
  for (const x of ["Напоминание о брошенной корзине", "Возвратные продажи", "Покупателям"])
    await expect(page.getByText(x, { exact: true }).first(), x).toBeVisible();
  expect(errors).toEqual([]);
});
