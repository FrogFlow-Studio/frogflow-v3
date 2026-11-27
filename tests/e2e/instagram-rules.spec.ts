import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";
import { watch } from "./helpers.ts";

/**
 * А2 (Кристина, 07.10): форма правила Comment-to-DM открывается над списком
 * правил, страница прокручивается к ней; «Скопировать» заполняет форму нового
 * правила текстами и кнопками исходного, пост выбирается заново. Правила —
 * из seed/comment-to-dm.ts. Ничего не сохраняем: правила общие с
 * comment-to-dm.spec.ts.
 */
test("скопировать правило Instagram → форма сверху заполнена", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/instagram");

  const rulesTitle = page.getByRole("heading", { name: "Правила Comment-to-DM", exact: true });
  await expect(rulesTitle).toBeVisible();
  const rule = page.locator(`[id="ig-rule-${F.RULE_V2}"]`);
  await expect(rule.getByText("Хочу", { exact: true })).toBeVisible();

  const formTitle = page.getByRole("heading", { name: "Новое правило — копия", exact: true });
  const copy = rule.getByRole("button", { name: "Скопировать", exact: true });
  // Клик до гидратации страницы пропадает — повторяем, пока форма не откроется.
  await expect(async () => {
    if (!(await formTitle.isVisible())) await copy.click();
    await expect(formTitle).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  const form = page.locator("section", { has: formTitle });
  await expect(form).toBeInViewport();
  // Форма над списком правил — и на компьютере, и на телефоне.
  const formBox = await form.boundingBox();
  const rulesBox = await rulesTitle.boundingBox();
  expect(formBox!.y).toBeLessThan(rulesBox!.y);

  await expect(form.getByLabel("Название", { exact: true })).toHaveValue("Хочу (копия)");
  // У поля подсказка со счётчиком знаков — имя длиннее подписи.
  await expect(form.getByLabel(/^Сообщение в Direct/)).toHaveValue(/^Спасибо за комментарий!/);
  await expect(form.getByPlaceholder("Текст кнопки", { exact: true })).toHaveValue("📚 Каталог");
  await expect(form.getByLabel("Текст второго сообщения", { exact: true })).toHaveValue(
    "Вот каталог — выбирайте 👇",
  );
  // Пост не скопирован: выбран «все посты», выбрать нужно заново (у поля подсказка — имя длиннее).
  await expect(form.getByLabel(/^Пост/)).toHaveValue("");
  await expect(form.getByText(/Тексты, кнопки и настройки взяты из правила «Хочу»/)).toBeVisible();

  // Нетронутую копию можно закрыть без вопросов.
  await form.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(formTitle).toBeHidden();
  expect(errors).toEqual([]);
});

/**
 * Клиентка 15.11: в каждое правило к видео пишет один и тот же текст, меняются
 * только название и цена. «Сделать текстом по умолчанию» — и новое правило
 * открывается с этим текстом. Правила не сохраняем (общие с comment-to-dm.spec.ts).
 */
test("текст по умолчанию: сохранили в форме — новое правило открывается с ним", async ({
  page,
}) => {
  const errors = await watch(page);
  await page.goto("/admin/login");
  await page.locator('input[name="username"]').fill(F.SELLER_LOGIN);
  await page.locator('input[name="password"]').fill(F.SELLER_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/instagram");

  const formTitle = page.getByRole("heading", { name: "Новое правило", exact: true });
  const add = page.getByRole("button", { name: "+ Новое правило", exact: true });
  await expect(async () => {
    if (!(await formTitle.isVisible())) await add.click();
    await expect(formTitle).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  const form = page.locator("section", { has: formTitle });
  const dm = form.getByLabel(/^Сообщение в Direct/);
  const text = `Видеоурок «Название» — цена ₸. Ответьте «+» ${test.info().project.name}`;
  await dm.fill(text);
  await form.getByRole("button", { name: "Сделать текстом по умолчанию", exact: true }).click();
  await expect(
    form.getByText("Сохранено: новые правила откроются с этим текстом.", { exact: true }),
  ).toBeVisible();

  // Сохранено на сервере, а не только в форме: после перезагрузки новое правило — с текстом.
  page.on("dialog", (d) => void d.accept());
  await page.reload();
  await expect(async () => {
    if (!(await formTitle.isVisible())) await add.click();
    await expect(formTitle).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(form.getByLabel(/^Сообщение в Direct/)).toHaveValue(/^Видеоурок «Название»/);
  await expect(
    form.getByText("Текст подставлен по умолчанию — поменяйте название и цену.", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
