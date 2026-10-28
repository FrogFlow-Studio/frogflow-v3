import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";
import { LEAD_BAKERY, LEAD_COFFEE } from "./seed/leads.ts";

/**
 * Воронка лидов оператора: список со счётчиками стадий, смена стадии с
 * журналом, заметка, новый лид без дублей. Таблицы общие с v1.
 */

async function operatorLogin(page: import("@playwright/test").Page) {
  await page.goto("/operator/login");
  await page.locator('input[name="username"]').fill(F.OPERATOR_LOGIN);
  await page.locator('input[name="password"]').fill(F.OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/operator$/);
}

test("лиды без входа оператора уводят на страницу входа", async ({ page }) => {
  await page.goto("/operator/leads");
  await expect(page).toHaveURL(/\/operator\/login$/);
});

test("лиды: список, фильтр по стадии, смена стадии с журналом, заметка", async ({ page }, info) => {
  const errors = await watch(page);
  // Два проекта (desktop и phone) идут параллельно на одной базе: свой лид у каждого.
  const mine = `E2E Лид ${info.project.name} ${Date.now()}`;
  await operatorLogin(page);
  await page.goto("/operator/leads");
  await expect(page).toHaveURL(/\/operator\/leads$/);
  await expect(page.getByRole("heading", { name: "Лиды", exact: true })).toBeVisible();
  await expect(page.getByText(LEAD_COFFEE)).toBeVisible();
  await expect(page.getByText(LEAD_BAKERY)).toBeVisible();

  // Счётчик стадии фильтрует список.
  await page.getByRole("button", { name: /^Ответил · \d+$/ }).click();
  await expect(page.getByText(LEAD_BAKERY)).toBeVisible();
  await expect(page.getByText(LEAD_COFFEE)).toHaveCount(0);
  await page.getByRole("button", { name: /^Все · \d+$/ }).click();

  const form = page.locator("form", { hasText: "Добавить лид" });
  await form.locator('input[name="businessName"]').fill(mine);
  await form.locator('input[name="phone"]').fill(`7${String(Date.now()).slice(-10)}`);
  await form.getByRole("button", { name: "Добавить лид", exact: true }).click();
  await expect(page.getByText("Лид добавлен")).toBeVisible();

  // Смена стадии пишется и видна в журнале лида.
  const card = page.locator("section", { hasText: mine }).first();
  await card.getByLabel("Стадия").selectOption("contacted");
  await expect(page.getByText(`${mine}: Написали`)).toBeVisible();
  await card.getByRole("button", { name: "Журнал", exact: true }).click();
  await expect(card.getByText("Новый → Написали")).toBeVisible();

  await card.getByLabel("Заметки").fill("созвон в четверг");
  await card.getByRole("button", { name: "Сохранить заметку", exact: true }).click();
  await expect(page.getByText(`${mine}: заметка сохранена`)).toBeVisible();

  await page.getByLabel("Поиск по лидам").fill("пекарня");
  await expect(page.locator("section", { hasText: mine })).toHaveCount(0);
  await expect(page.locator("section", { hasText: LEAD_BAKERY })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("лиды: новый лид сохраняется, тот же Instagram второй раз не добавляется", async ({
  page,
}, info) => {
  const errors = await watch(page);
  await operatorLogin(page);
  await page.goto("/operator/leads");
  const form = page.locator("form", { hasText: "Добавить лид" });
  const name = `E2E Лид ${info.project.name} ${Date.now()}`;
  const handle = `e2e.${info.project.name}${Date.now()}`;
  await form.locator('input[name="businessName"]').fill(name);
  await form.locator('input[name="instagramHandle"]').fill(`@${handle}`);
  await form.getByRole("button", { name: "Добавить лид", exact: true }).click();
  await expect(page.getByText("Лид добавлен")).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();

  await form.locator('input[name="businessName"]').fill("Другое название");
  await form
    .locator('input[name="instagramHandle"]')
    .fill(`https://instagram.com/${handle.toUpperCase()}/`);
  await form.getByRole("button", { name: "Добавить лид", exact: true }).click();
  await expect(page.getByText(`Такой лид уже есть: ${name}`)).toBeVisible();
  expect(errors).toEqual([]);
});

test("лиды: крон конвейера по умолчанию выключен, срок напоминания сохраняется", async ({
  page,
}) => {
  const errors = await watch(page);
  await operatorLogin(page);
  await page.goto("/operator/leads");
  await page.getByText("Настроить автоматический поиск лидов", { exact: true }).click();
  const card = page.locator("section", { hasText: "Конвейер лидов" });
  await expect(card.getByLabel("Крон включён")).not.toBeChecked();
  await card.getByLabel("Напомнить через, дней").fill("5");
  await card.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(card.getByText("Сохранено")).toBeVisible();
  await page.reload();
  await page.getByText("Настроить автоматический поиск лидов", { exact: true }).click();
  await expect(card.getByLabel("Напомнить через, дней")).toHaveValue("5");
  await expect(card.getByLabel("Крон включён")).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("лиды: черновик, ссылка WhatsApp с текстом и «Связались» двигают лид в «Написали»", async ({
  page,
}, info) => {
  const errors = await watch(page);
  const mine = `E2E Черновик ${info.project.name} ${Date.now()}`;
  const phone = `7${String(Date.now()).slice(-10)}`;
  await operatorLogin(page);
  await page.goto("/operator/leads");
  const form = page.locator("form", { hasText: "Добавить лид" });
  await form.locator('input[name="businessName"]').fill(mine);
  await form.locator('input[name="phone"]').fill(phone);
  await form.getByRole("button", { name: "Добавить лид", exact: true }).click();
  await expect(page.getByText("Лид добавлен")).toBeVisible();

  const card = page.locator("section", { hasText: mine }).first();
  // Подставная модель отвечает фиксированным текстом: он попадает в черновик (какой именно — зависит от слов в подсказке).
  await card.getByRole("button", { name: "Написать черновик", exact: true }).click();
  await expect(card.getByLabel("Черновик сообщения")).not.toHaveValue("");
  await expect(page.getByText(`${mine}: черновик готов`, { exact: false })).toBeVisible();
  await card.getByLabel("Черновик сообщения").fill("Здравствуйте, расскажу про бота");
  await expect(card.getByRole("link", { name: "Открыть WhatsApp", exact: true })).toHaveAttribute(
    "href",
    `https://wa.me/${phone}?text=${encodeURIComponent("Здравствуйте, расскажу про бота")}`,
  );
  await card.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
  await expect(page.getByText(`${mine}: черновик сохранён`)).toBeVisible();

  await card.getByRole("button", { name: "Связались", exact: true }).click();
  await expect(page.getByText(`${mine}: WhatsApp, стадия «Написали»`)).toBeVisible();
  await card.getByRole("button", { name: "Журнал", exact: true }).click();
  await expect(card.getByText("Написали: whatsapp")).toBeVisible();
  expect(errors).toEqual([]);
});

test("лиды: импорт из CSV — новые добавлены, повтор файла даёт только дубли", async ({
  page,
}, info) => {
  const errors = await watch(page);
  const name = `E2E Импорт ${info.project.name} ${Date.now()}`;
  const phone = `7${String(Date.now()).slice(-10)}`;
  const csv = `Название;Город;Телефон\n${name};Алматы;${phone}\nБез контакта;Астана;\n`;
  await operatorLogin(page);
  await page.goto("/operator/leads");
  const card = page.locator("section", { hasText: "Импорт из CSV" });
  const upload = async () => {
    await card
      .locator('input[type="file"]')
      .setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await card.getByRole("button", { name: "Загрузить лидов", exact: true }).click();
  };
  await upload();
  await expect(card.getByText("Добавлено 1, дублей 0, ошибок строк 1")).toBeVisible();
  await expect(card.getByText("Строка 3: нет рабочего контакта", { exact: false })).toBeVisible();
  await expect(page.locator("section", { hasText: name }).first()).toBeVisible();
  await upload();
  await expect(card.getByText("Добавлено 0, дублей 1, ошибок строк 1")).toBeVisible();
  expect(errors).toEqual([]);
});
