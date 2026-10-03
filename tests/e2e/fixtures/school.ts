/** Онлайн-школа (seed/school.ts, school.spec.ts): курс с потоком и заданием. */
export const SCHOOL_ID = "e2e00000-0000-4000-8000-000000000005";
export const SCHOOL_SLUG = "e2e-school";
export const SCHOOL_BOT_TOKEN = "700000005:E2E-school-token";
export const SCHOOL_COURSE_ID = "e2e00000-0000-4000-8000-0000000005c1";
export const SCHOOL_COURSE_NAME = "Аквагрим с нуля";
/** По покупке на проект Playwright (desktop, phone): сдача одного не мешает другому. */
export const SCHOOL_ITEM_IDS = [
  "e2e00000-0000-4000-8000-0000000005d1",
  "e2e00000-0000-4000-8000-0000000005d2",
];
export const SCHOOL_LESSON_1 = "e2e00000-0000-4000-8000-0000000005a1";
export const SCHOOL_LESSON_2 = "e2e00000-0000-4000-8000-0000000005a2";
export const SCHOOL_COHORT_ID = "e2e00000-0000-4000-8000-0000000005b1";

/** Продавец школы: проверяет домашние задания и смотрит воронку (school.spec.ts, сквозной путь). */
export const SCHOOL_SELLER_LOGIN = "e2e_school_teacher";
export const SCHOOL_SELLER_PASSWORD = "e2e-school-pass-123";
/**
 * Сквозной путь: курс «по заданиям» на проект Playwright (desktop, phone) — у
 * каждого свой курс и своя покупка, чтобы воронка и очередь ДЗ не смешивались.
 */
export const SCHOOL_FLOW_COURSE_IDS = [
  "e2e00000-0000-4000-8000-0000000005c2",
  "e2e00000-0000-4000-8000-0000000005c3",
];
export const SCHOOL_FLOW_COURSE_NAMES = ["Лепка с нуля", "Керамика с нуля"];
export const SCHOOL_FLOW_ITEM_IDS = [
  "e2e00000-0000-4000-8000-0000000005e1",
  "e2e00000-0000-4000-8000-0000000005e2",
];
