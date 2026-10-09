import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * Рабочее место консультанта без продаж (BOVI, макет 08.10): шесть страниц
 * меню — «Обзор», «Задачи», «Диалоги», «Прайс», «База знаний», «Настройки
 * бота». Продающий магазин с прайсом видит прежние страницы.
 */
async function login(page: Page, user = F.BOVI_WS_LOGIN, pass = F.BOVI_WS_PASSWORD) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(pass);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

const WS_PAGES = ["Задачи", "Диалоги", "Прайс", "База знаний", "Настройки бота"];

test("Обзор: сегодня, кто ждёт менеджера, что проверить, передачи по дням", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = await watch(page);
  await login(page);
  const menu = page.locator("aside").first();
  for (const x of WS_PAGES)
    await expect(menu.getByRole("link", { name: new RegExp(`^${x}`) }).first(), x).toBeVisible();
  await expect(menu.getByRole("link", { name: "Заказы", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Товары", exact: true })).toHaveCount(0);

  const ws = page.getByTestId("ws-overview");
  await expect(ws.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await expect(ws.getByText("Консультант включён", { exact: true })).toBeVisible();
  await expect(ws.getByText("Передано менеджеру", { exact: true })).toBeVisible();
  await expect(ws.getByRole("heading", { name: "Ждут менеджера · 2", exact: true })).toBeVisible();
  await expect(ws.getByText(F.BOVI_WS_IG_TASK, { exact: true })).toBeVisible();
  await expect(ws.getByText(F.BOVI_WS_WA_TASK, { exact: true })).toBeVisible();
  // Статья без тегов — в «Что проверить», с переходом в «Базу знаний».
  const alerts = page.getByTestId("ws-alerts");
  await expect(alerts.getByText("Статьи без тегов: 1", { exact: true })).toBeVisible();
  await expect(
    alerts.getByRole("link", { name: "Открыть базу знаний", exact: true }),
  ).toHaveAttribute("href", "/admin/knowledge");
  await expect(page.getByTestId("ws-week")).toContainText("За 7 дней");
  expect(errors).toEqual([]);
});

test("Задачи: открытые и сделанные, диалог открывается в панели", async ({ page }) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/tasks");
  await expect(page.getByRole("heading", { name: "Задачи", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Открытые · 2", exact: true })).toBeVisible();
  const ig = page.getByTestId("ws-task").filter({ hasText: F.BOVI_WS_IG_NAME });
  await expect(ig.getByText("Готов купить", { exact: true })).toBeVisible();
  await expect(ig.getByRole("link", { name: "Открыть диалог", exact: true })).toHaveAttribute(
    "href",
    `/admin/chat?c=${F.BOVI_WS_IG_ID}`,
  );
  // Сделанные: чем закрыта задача.
  await page.getByRole("tab", { name: "Сделанные · 1", exact: true }).click();
  await expect(page.getByText(F.BOVI_WS_DONE_NAME, { exact: true })).toBeVisible();
  await expect(page.getByText(/^Закрыта: вы ответили в Instagram/)).toBeVisible();

  // Фильтр канала: только WhatsApp.
  await page.getByRole("tab", { name: /^Открытые/ }).click();
  await page.getByLabel("Канал", { exact: true }).selectOption("whatsapp");
  await expect(page.getByTestId("ws-task")).toHaveCount(1);
  await expect(page.getByText(F.BOVI_WS_WA_NAME, { exact: true })).toBeVisible();
  await page.getByLabel("Канал", { exact: true }).selectOption("");

  await ig.getByRole("link", { name: "Открыть диалог", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/chat\\?c=${F.BOVI_WS_IG_ID}`));
  await expect(page.getByText(F.BOVI_WS_IG_QUESTION, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Диалоги: «Ждут менеджера» и журнал консультанта", async ({ page }) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/chat");
  await expect(page.getByRole("heading", { name: "Диалоги", exact: true })).toBeVisible();
  await expect(page.getByText("ждёт менеджера", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Ждут менеджера · 2", exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(F.BOVI_WS_IG_NAME) })
    .first()
    .click();
  await expect(page.getByText(F.BOVI_WS_IG_QUESTION, { exact: true })).toBeVisible();
  // Баллов и заказов у консультанта без продаж нет.
  await expect(page.getByText("Последние заказы", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Журнал консультанта", exact: true }).click();
  const journal = page.getByTestId("ws-journal");
  await expect(journal.getByText(F.BOVI_WS_IG_ANSWER)).toBeVisible();
  await expect(journal.getByText("передал менеджеру: Готов купить", { exact: true })).toBeVisible();
  await expect(journal.getByText("промолчал: диалог у менеджера", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Прайс: файл, таблица, курс и фото с числом подходящих позиций", async ({ page }) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/pricelist");
  await expect(page.getByRole("heading", { name: "Прайс", exact: true })).toBeVisible();
  for (const card of [
    "Прайс из 1С",
    "Прайс из Google Таблицы",
    "Курс рубля",
    "Фото и видео товаров",
  ])
    await expect(page.getByRole("heading", { name: card, exact: true }), card).toBeVisible();
  await expect(page.getByText("Подходит к позициям прайса: 2", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Ни одной позиции в прайсе — проверьте написание.", { exact: true }),
  ).toBeVisible();
  // Задачи, база знаний и образ — на своих страницах.
  for (const card of ["Задачи консультанта", "База знаний", "Образ консультанта"])
    await expect(page.getByRole("heading", { name: card, exact: true }), card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("База знаний: поиск, статья по одной, новая статья и удаление", async ({ page }, info) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/knowledge");
  await expect(page.getByRole("heading", { name: "База знаний", exact: true })).toBeVisible();
  await expect(page.getByText("без тегов", { exact: true })).toBeVisible();
  await page.getByLabel("Найти статью", { exact: true }).fill("сатин");
  await expect(page.getByTestId("kb-article")).toHaveCount(1);
  await page.getByRole("button", { name: new RegExp(`^${F.BOVI_WS_ARTICLE}`) }).click();
  await expect(page.getByLabel("Заголовок", { exact: true })).toHaveValue(F.BOVI_WS_ARTICLE);
  await page.getByRole("button", { name: new RegExp(`^${F.BOVI_WS_ARTICLE}`) }).click();
  await page.getByLabel("Найти статью", { exact: true }).fill("");

  // Статьи пишутся всем списком: два проекта разом затёрли бы друг другу новую статью.
  if (info.project.name !== "desktop") {
    expect(errors).toEqual([]);
    return;
  }
  // Новая статья — своя на каждый прогон.
  const title = `Доставка ${info.project.name}-${Date.now()}`;
  await page.getByRole("button", { name: "Новая статья", exact: true }).click();
  await page.getByLabel("Заголовок", { exact: true }).fill(title);
  await page.getByLabel(/^Теги — по ним консультант находит статью/).fill("доставка");
  await page.getByLabel("Текст", { exact: true }).fill("По Алматы — курьером в день заказа.");
  await page.getByRole("button", { name: "Сохранить статью", exact: true }).click();
  await expect(page.getByText("Статья сохранена.", { exact: true })).toBeVisible();
  const added = page.getByRole("button", { name: new RegExp(`^${title}`) });
  await expect(added).toBeVisible();

  await added.click();
  await page.getByRole("button", { name: "Удалить…", exact: true }).click();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(added).toHaveCount(0);
  await expect(page.getByTestId("kb-article")).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("Настройки бота: работа, часы, образ и пробный диалог с историей", async ({
  page,
  request,
}) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/consultant");
  await expect(page.getByRole("heading", { name: "Настройки бота", exact: true })).toBeVisible();
  for (const card of [
    "Работа",
    "Марки, сайт и бутик",
    "Образ консультанта",
    "Проверить консультанта",
  ])
    await expect(page.getByRole("heading", { name: card, exact: true }), card).toBeVisible();
  await expect(page.getByText("Когда отвечает человек, бот молчит", { exact: true })).toBeVisible();

  const box = page.getByLabel("Вопрос как покупатель…", { exact: true });
  const first = `Есть сатин евро? ${Date.now()}`;
  await box.fill(first);
  await page.getByRole("button", { name: "Спросить", exact: true }).click();
  const log = page.getByTestId("ws-test-log");
  await expect(log.getByText(F.CONS_ANSWER).first()).toBeVisible();
  await box.fill("А в сером?");
  await page.getByRole("button", { name: "Спросить", exact: true }).click();
  await expect(log.getByText(F.CONS_ANSWER)).toHaveCount(2);
  // Второй вопрос ушёл модели вместе с первым: консультант помнит, о чём шла речь.
  type Asked = { messages?: { role: string; content: unknown }[] };
  // Заглушка общая для параллельных воркеров: ищем свой запрос по метке первого вопроса.
  const asked = (await (await request.get(`${F.STUB}/__e2e/anthropic`)).json()) as Asked[];
  const mine = asked
    .map((a) => JSON.stringify(a.messages ?? []))
    .filter((m) => m.includes("А в сером?"));
  expect(mine.some((m) => m.includes(first))).toBe(true);

  await page.getByRole("button", { name: "Начать заново", exact: true }).click();
  await expect(log.getByText(F.CONS_ANSWER)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("продающий магазин с прайсом: меню и страницы как раньше", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = await watch(page);
  await login(page, F.BOVI_E2E_LOGIN, F.BOVI_E2E_PASSWORD);
  await expect(page.getByTestId("ws-overview")).toHaveCount(0);
  const menu = page.locator("aside").first();
  for (const x of ["Задачи", "Диалоги", "База знаний", "Настройки бота"])
    await expect(menu.getByRole("link", { name: x, exact: true }), x).toHaveCount(0);
  await page.goto("/admin/pricelist");
  await expect(
    page.getByRole("heading", { name: "Прайс консультанта", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Задачи консультанта", exact: true }),
  ).toBeVisible();
  await page.goto("/admin/consultant");
  await expect(page.getByRole("heading", { name: "Настройки бота", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
