import { z } from "zod";

/**
 * Кнопка под сообщением в Direct из формы правила. Форма хранит обе строки
 * (ссылку и команду) и при смене типа не стирает другую: новая кнопка
 * создаётся ссылкой с `url: ""`, и «команда боту» приходила с пустой
 * ссылкой — `url()` её отклонял, и правило не сохранялось вовсе. Берём
 * только поле выбранного типа; ссылку для типа «ссылка» проверяем, как раньше.
 * Иначе normalizeDmButtons (channels/zernio/api.server) превратил бы
 * команду с оставшейся ссылкой в кнопку-ссылку.
 */
export const buttonSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const b = raw as Record<string, unknown>;
    if (b.type === "postback") return { type: b.type, title: b.title, payload: b.payload };
    if (b.type === "url") return { type: b.type, title: b.title, url: b.url };
    return raw;
  },
  z.object({
    type: z.enum(["url", "postback"]),
    title: z.string().min(1).max(40),
    url: z.string().url().max(500).optional(),
    payload: z.string().max(100).optional(),
  }),
);

/**
 * Подпись поста — только для списка правил (там видны первые 40 знаков).
 * Подпись к Reels бывает длиннее 500 знаков: раньше такой пост было нельзя
 * выбрать в правиле — форма падала проверкой. Длинную обрезаем, не отклоняем.
 */
export const postTitleSchema = z
  .string()
  .transform((s) => s.slice(0, 500))
  .optional();
