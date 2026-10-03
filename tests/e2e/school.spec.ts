import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import * as F from "./fixtures.ts";

/**
 * Онлайн-школа на собранном приложении: карточка курса на витрине — как
 * лендинг (программа, поток, что входит); страница курса по подписанной
 * ссылке — открытый урок с заданием и сдача ответа. База — подставная
 * (seed/school.ts).
 */
const token = (itemId: string) =>
  createHmac("sha256", F.SECRETS_KEY)
    .update(`course:${F.SCHOOL_ID}:${itemId}`)
    .digest("base64url")
    .slice(0, 22);

test("карточка курса: программа, поток и что входит", async ({ page }) => {
  await page.goto(`/s/${F.SCHOOL_SLUG}/p/${F.SCHOOL_COURSE_ID}`);
  await expect(
    page.getByRole("heading", { name: F.SCHOOL_COURSE_NAME, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Программа курса · уроков: 2")).toBeVisible();
  await expect(page.getByText(/Поток «Октябрь» — старт/)).toBeVisible();
  await expect(page.getByText("✓ Проверка домашних заданий")).toBeVisible();
  await expect(page.getByText("Кисти и краски")).toBeVisible();
});

test("страница курса: урок открыт, задание сдаётся; чужая подпись — не найдено", async ({
  page,
}, info) => {
  const item = F.SCHOOL_ITEM_IDS[info.project.name === "desktop" ? 0 : 1]!;
  const bad = await page.goto(`/s/${F.SCHOOL_SLUG}/course/${item}?k=${"x".repeat(22)}`);
  expect(bad?.status()).toBe(404);

  await page.goto(`/s/${F.SCHOOL_SLUG}/course/${item}?k=${token(item)}`);
  await expect(page.getByText("Разбираем инструменты.")).toBeVisible();
  await expect(page.getByText("Нарисуйте круг и пришлите фото.")).toBeVisible();
  // Ссылка на YouTube — встроенный плеер, а не только кнопка.
  await expect(page.locator("iframe").first()).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  await page.getByPlaceholder("Ответ или комментарий к работе").first().fill("Круг готов");
  await page.getByRole("button", { name: "Отправить на проверку", exact: true }).click();
  await expect(page.getByText("Отправлено. Преподаватель проверит и ответит.")).toBeVisible();
});

test("сквозной путь школы: открытый урок, тест, задание, приём, воронка", async ({
  page,
  browser,
}, info) => {
  const i = info.project.name === "desktop" ? 0 : 1;
  const course = F.SCHOOL_FLOW_COURSE_NAMES[i]!;
  const item = F.SCHOOL_FLOW_ITEM_IDS[i]!;

  // До покупки: открытый урок виден, закрытый — нет; курс кладётся в корзину.
  await page.goto(`/s/${F.SCHOOL_SLUG}/p/${F.SCHOOL_FLOW_COURSE_IDS[i]}`);
  await expect(page.getByText("Первый сосуд")).toBeVisible();
  await expect(page.getByText("Мнём глину.")).toBeHidden();
  await page.getByText("Открытый урок — посмотреть бесплатно").click();
  await expect(page.getByText("Мнём глину.")).toBeVisible();
  await expect(page.getByText("Делаем кувшин.")).toHaveCount(0);
  await page.getByRole("button", { name: "🛒 В корзину", exact: true }).click();
  await page.goto(`/s/${F.SCHOOL_SLUG}/cart`);
  await expect(page.getByText(course).first()).toBeVisible();

  // После покупки: первый урок открыт, второй ждёт задания.
  await page.goto(`/s/${F.SCHOOL_SLUG}/course/${item}?k=${token(item)}`);
  await expect(page.getByText("Мнём глину.")).toBeVisible();
  await expect(page.getByText("Делаем кувшин.")).toHaveCount(0);

  // Тест к уроку: ответ выбирается на странице курса, результат виден сразу.
  await expect(page.getByText("1. Из чего лепят?")).toBeVisible();
  await page.getByText("Глина", { exact: true }).click();
  await page.getByRole("button", { name: "Проверить ответы", exact: true }).click();
  await expect(page.getByText("Тест пройден")).toBeVisible();

  // Задание сдаётся и ждёт проверки.
  await page.getByPlaceholder("Ответ или комментарий к работе").first().fill("Шар готов");
  await page.getByRole("button", { name: "Отправить на проверку", exact: true }).click();
  await expect(page.getByText("Отправлено. Преподаватель проверит и ответит.")).toBeVisible();

  // Продавец принимает работу в «Домашних заданиях».
  const teacher = await browser.newPage();
  await teacher.goto("/admin/login");
  await teacher.locator('input[name="username"]').fill(F.SCHOOL_SELLER_LOGIN);
  await teacher.locator('input[name="password"]').fill(F.SCHOOL_SELLER_PASSWORD);
  await teacher.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(teacher).toHaveURL(/\/admin$/);
  await teacher.goto("/admin/homework");
  const card = teacher.locator("section.card").filter({ hasText: course });
  await expect(card.getByText("Шар готов")).toBeVisible();
  await card.getByRole("button", { name: "✓ Принять", exact: true }).click();
  // Принятая работа уходит из вкладки «Ждут проверки».
  await expect(card).toHaveCount(0);

  // Урок пройден у ученика: второй урок открылся.
  await page.goto(`/s/${F.SCHOOL_SLUG}/course/${item}?k=${token(item)}`);
  await expect(page.getByText("Делаем кувшин.")).toBeVisible();

  // Воронка на «Учениках»: один ученик открыл оба урока и сдал задание.
  await teacher.goto("/admin/students");
  const funnel = teacher
    .locator("section.card")
    .filter({ hasText: course })
    .locator("details")
    .filter({ hasText: "Где отваливаются" });
  await funnel.locator("summary").first().click();
  await expect(funnel.getByText("1. Основы лепки")).toBeVisible();
  await expect(funnel.getByText("2. Первый сосуд")).toBeVisible();
  // Колонки: открыли, сдали ДЗ, прошли урок.
  const lesson1 = funnel.locator("tr").filter({ hasText: "1. Основы лепки" }).locator("td");
  await expect(lesson1.nth(1)).toHaveText("1 (100%)");
  await expect(lesson1.nth(2)).toHaveText("1 (100%)");
  await expect(lesson1.nth(3)).toHaveText("1 (100%)");
  const lesson2 = funnel.locator("tr").filter({ hasText: "2. Первый сосуд" }).locator("td");
  await expect(lesson2.nth(1)).toHaveText("1 (100%)");
  await expect(lesson2.nth(3)).toHaveText("0 (0%)");
  // Клик по цифре открывает список: число совпадает с цифрой.
  await lesson1.nth(2).getByRole("button").click();
  await expect(funnel.getByText("Мария").first()).toBeVisible();
  await teacher.close();
});
