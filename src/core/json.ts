import type { Json } from "@/core/db-types";

/**
 * Единственное место, где значение приводится к столбцу jsonb. Супабейс
 * сериализует его сам (JSON.stringify), поэтому проверка формы не нужна, а
 * `as unknown as Json` по коду размножался копиями.
 */
export function toJson(value: unknown): Json {
  return value as Json;
}

/**
 * Прочитанный из jsonb столбца объект как тип T. Форму база не гарантирует,
 * поэтому T описывает то, что пишет наш же код, а читающий проверяет поля.
 */
export function fromJson<T>(value: Json | null | undefined): T {
  return value as unknown as T;
}
