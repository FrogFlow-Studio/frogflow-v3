/**
 * Раздел словаря админки: русский — источник ключей, остальные языки обязаны
 * перевести каждый ключ (тип не даст забыть строку при добавлении).
 */
export type SectionDict<R extends Record<string, string>> = Record<keyof R, string>;
