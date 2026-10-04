import { expect, test, type Page } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/** Диалоги продавца, партия 16: список постранично, поиск, «непрочитанные», ссылка на диалог. */
async function login(page: Page) {
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function openChat(page: Page, name: string) {
  await login(page);
  await page.goto("/admin/chat");
  await page.getByRole("button", { name }).click();
}

test("чат: список постранично — «Показать ещё», поиск на сервере, непрочитанные", async ({
  page,
}) => {
  const errors = await watch(page);
  await openChat(page, F.CHAT_TG_NAME);
  const dialog = (n: number) =>
    page.getByRole("button", { name: new RegExp(`^${F.chatManyName(n)}(?!\\d)`) });
  // Первая страница — 50 диалогов: самый свежий «Клиент 1» есть, самый старый — ещё нет.
  await expect(dialog(1)).toHaveCount(1);
  await expect(dialog(F.CHAT_MANY_COUNT)).toHaveCount(0);
  await page.getByRole("button", { name: "Показать ещё", exact: true }).click();
  await expect(dialog(F.CHAT_MANY_COUNT)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Показать ещё", exact: true })).toHaveCount(0);

  // Поиск идёт на сервере и находит диалог, которого на первой странице не было.
  const search = page.getByPlaceholder("Поиск по имени или @username");
  await search.fill(`${F.chatManyName(F.CHAT_MANY_COUNT)}`);
  await expect(dialog(F.CHAT_MANY_COUNT)).toHaveCount(1);
  await expect(dialog(1)).toHaveCount(0);
  await search.fill("");
  await expect(dialog(1)).toHaveCount(1);

  // «Непрочитанные»: нечётные клиенты, чётных нет.
  await page.getByRole("button", { name: /^Непрочитанные/ }).click();
  await expect(dialog(1)).toHaveCount(1);
  await expect(dialog(2)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("чат: боковая панель покупателя — баллы, заказы, сумма покупок, карточка", async ({
  page,
}) => {
  const errors = await watch(page);
  await openChat(page, F.CHAT_PANEL_NAME);
  const panel = page.getByRole("complementary", { name: "Покупатель", exact: true });
  await expect(panel.getByText(String(F.CHAT_PANEL_POINTS), { exact: true })).toBeVisible();
  await expect(panel.getByText(`#${F.CHAT_PANEL_ORDER_NO}`, { exact: true })).toBeVisible();
  await expect(panel.getByText(`#${F.CHAT_PANEL_CANCELLED_NO}`, { exact: true })).toBeVisible();
  // Сумма покупок — один оплаченный заказ: отменённый в неё не входит.
  await expect(panel.getByText(/12\s?500/)).toHaveCount(3);
  await panel.getByRole("link", { name: "Карточка покупателя", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/customers\//);
  expect(errors).toEqual([]);
});

test("чат: ссылка из напоминания открывает диалог, которого нет на первой странице списка", async ({
  page,
}) => {
  const errors = await watch(page);
  await login(page);
  const last = F.CHAT_MANY_COUNT;
  await page.goto(`/admin/chat?c=${F.chatManyId(last)}`);
  // Имя в шапке диалога; в списке этого покупателя ещё нет (он на второй странице).
  await expect(page.getByText(`${F.chatManyName(last)} id ${F.chatManyId(last)}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Показать ещё", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("чат: заметка и теги правятся в панели диалога и видны в карточке покупателя", async ({
  page,
}) => {
  const errors = await watch(page);
  // Проекты desktop и phone идут параллельно по одной базе: у каждого свой покупатель, иначе они спорят за одну заметку.
  const n = test.info().project.name === "phone" ? 6 : 5;
  await login(page);
  await page.goto(`/admin/chat?c=${F.chatManyId(n)}`);
  const panel = page.getByRole("complementary", { name: "Покупатель", exact: true });
  await panel.getByRole("textbox", { name: "Теги", exact: true }).fill("vip, опт");
  await panel
    .getByRole("textbox", { name: "Заметка для команды", exact: true })
    .fill("Звонить после 18");
  await panel.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(panel.getByText("Сохранено", { exact: true })).toBeVisible();
  await panel.getByRole("link", { name: "Карточка покупателя", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/customers\//);
  await expect(page.getByRole("textbox", { name: "Заметка для команды", exact: true })).toHaveValue(
    "Звонить после 18",
  );
  await expect(page.locator('input[list="customer-tags"]')).toHaveValue("vip, опт");
  expect(errors).toEqual([]);
});

test("чат: поиск по тексту находит сообщение и открывает диалог с историей до него", async ({
  page,
}) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/chat");
  await page.getByPlaceholder("Поиск по тексту переписки").fill("Самое первое");
  // Находка — в начале длинной переписки (230 сообщений, первая страница — 200).
  await page.getByRole("button", { name: /Самое первое сообщение/ }).click();
  const bubble = page.locator('[id^="msg-"]', { hasText: F.CHAT_LONG_FIRST });
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toBeInViewport();
  await expect(bubble).toHaveClass(/ring-2/);
  expect(errors).toEqual([]);
});

test("чат: поиск по тексту — ничего не найдено", async ({ page }) => {
  const errors = await watch(page);
  await login(page);
  await page.goto("/admin/chat");
  await page.getByPlaceholder("Поиск по тексту переписки").fill("такого текста нет нигде");
  await expect(page.getByText("Ничего не найдено", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
