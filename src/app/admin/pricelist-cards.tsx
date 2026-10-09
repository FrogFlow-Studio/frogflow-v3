/**
 * Карточки страницы «Прайс консультанта» (BOVI): общие для обычной страницы
 * и рабочего места консультанта («Прайс», «База знаний», «Задачи», «Настройки бота»).
 * Реализация — в `./pricelist/`.
 */
export { readCsv, type Data, type CardProps } from "./pricelist/shared";
export { FileCard } from "./pricelist/file-card";
export { type SheetPreview, SheetCard } from "./pricelist/sheet-card";
export { rateAttemptText, RateCard } from "./pricelist/rate-card";
export { SettingsCard } from "./pricelist/settings-card";
export { MediaCard } from "./pricelist/media-card";
export {
  KnowledgeCard,
  ArticlesEditor,
  type KbPreview,
  fileBase64,
  KnowledgeImport,
} from "./pricelist/knowledge";
export { PersonaCard } from "./pricelist/persona-card";
export { TasksCard, KNOWN_REASONS } from "./pricelist/tasks-card";
