import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * BOVI 06.10: консультант с модулем магазина из v1, но без товаров, видел на
 * «Обзоре» магазин: «Первые 7 дней» (закрыть нельзя), «Добавьте товары»,
 * выручку и «Последние заказы», а внизу — «Заказы» и «Товары».
 */
async function login(page: Page) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.BOVI_PLAN_LOGIN);
  await page.locator('input[name="password"]').fill(F.BOVI_PLAN_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("консультант без продаж: «Обзор» без карточек магазина", async ({ page }) => {
  const errors = await watch(page);
  await login(page);
  // Наверху рабочее место консультанта; магазинные «Ждёт вас», «Что сделать сегодня» и
  // «Покупателей» под ним лишние (партия 11): задачи и диалоги рабочее место показывает само.
  await expect(page.getByTestId("ws-overview")).toBeVisible();
  await expect(page.getByText("Покупателей", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ждёт вас", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Что сделать сегодня", exact: true })).toHaveCount(
    0,
  );
  // В таблице по дням — расход ИИ.
  await expect(page.getByTestId("ws-week").getByText("Расход ИИ", { exact: true })).toBeVisible();
  // У консультанта в «Запуске» только Telegram и уведомления: оба сделаны — карточки нет.
  await expect(page.getByText(/^Запуск (магазина|консультанта)/)).toHaveCount(0);
  await expect(page.getByText("Первые 7 дней", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Добавьте и включите товар", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Добавить 5 товаров", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Заполнить реквизиты продавца", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Написать приветствие магазина", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Последние заказы", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Выручка за 30 дней", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Товаров в продаже", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("консультант без продаж: внизу на телефоне задачи, прайс и база знаний", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const errors = await watch(page);
  await login(page);
  const bar = page.getByRole("navigation", { name: "Главные разделы", exact: true });
  // Рабочее место консультанта (bovi-workspace.spec.ts): модуля чата нет — без «Диалогов».
  for (const x of ["Задачи", "Прайс", "База знаний"])
    await expect(bar.getByRole("link", { name: x, exact: true }), x).toBeVisible();
  await expect(bar.getByRole("link", { name: "Заказы", exact: true })).toHaveCount(0);
  await expect(bar.getByRole("link", { name: "Товары", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("консультант без продаж: в меню нет заказов и товаров, в настройках — оплаты", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = await watch(page);
  await login(page);
  const menu = page.locator("aside");
  // Группы меню раскрываются по одной: в каждой — его разделы, без продажи.
  const group = async (name: string, has: string[], hasNot: string[]) => {
    // Кнопка группы — по группе: у свёрнутой в подписи бывает бейдж («Настройки 3» — новости).
    await menu.getByRole("group", { name, exact: true }).getByRole("button").first().click();
    for (const x of has)
      await expect(menu.getByRole("link", { name: x, exact: true }), x).toBeVisible();
    for (const x of hasNot)
      await expect(menu.getByRole("link", { name: x, exact: true }), x).toHaveCount(0);
  };
  // Страницы рабочего места закреплены сверху, как «Заказы» у магазина: видны без раскрытия групп.
  for (const x of ["Задачи", "Прайс", "База знаний", "Настройки бота"])
    await expect(menu.getByRole("link", { name: x, exact: true }), x).toBeVisible();
  await group("Продажи", ["Покупатели"], ["Заказы"]);
  // В «Каталоге» был только прайс — он сверху, пустой группы нет.
  await expect(menu.getByRole("group", { name: "Каталог", exact: true })).toHaveCount(0);
  await group("Маркетинг", ["Instagram"], ["Поделиться", "Товары", "Категории"]);
  await group("Настройки", ["Настройки"], ["Оплата и настройки", "Комиссия"]);
  await expect(menu.getByRole("group", { name: "Аналитика", exact: true })).toHaveCount(0);

  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Настройки", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Все", exact: true }).click();
  await expect(page.getByText("Telegram-бот", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Оплата и доставка", exact: true })).toHaveCount(0);
  for (const title of [
    "Способы оплаты по странам",
    "Физические товары: получение и оплата",
    "Зоны доставки",
    "Защита PDF от перепродажи",
    "Оформление витрины",
    "Новые автосообщения",
  ])
    await expect(page.getByText(title, { exact: true }), title).toBeHidden();
  // В карточке «Магазин» нет полей витрины и выдачи материалов.
  for (const label of ["Подзаголовок витрины", "Цвет витрины", "Текст инструкции покупателю"])
    await expect(page.getByText(label, { exact: true }), label).toHaveCount(0);

  // Скрытые из меню страницы по прямой ссылке открываются без ошибок.
  for (const path of ["/admin/orders", "/admin/products"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("body"), path).not.toContainText(
      /Cannot read|undefined|TypeError|Internal Server Error/,
    );
  }
  expect(errors).toEqual([]);
});

test("консультант по прайсу: в «Настройках бота» нет полей, которые прайс не читает", async ({
  page,
}) => {
  const errors = await watch(page);
  await login(page);
  // Прежний адрес страницы консультанта — теперь «Настройки бота» рабочего места.
  await page.goto("/admin/consultant");
  await expect(page.getByRole("heading", { name: "Настройки бота", exact: true })).toBeVisible();
  for (const label of ["Условия доставки", "Условия оплаты", "Цель диалога", "Тон общения"])
    await expect(page.getByText(label, { exact: true }), label).toHaveCount(0);
  // Включатель и пауза остаются: их консультант по прайсу слушает.
  await expect(page.getByText("Когда отвечает человек, бот молчит", { exact: true })).toBeVisible();
  await page.goto("/admin/customers");
  await expect(page.getByText("Покупателей пока нет", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Добавить товары", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
