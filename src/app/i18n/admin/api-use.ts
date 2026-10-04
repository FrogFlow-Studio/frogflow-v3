import type { SectionDict } from "../section";

/** Ключ публичного API: последнее использование (И3). */
export const ru = {
  "apiuse.last": "Ключ использовали в последний раз: {when}. Откуда: {from}.",
  "apiuse.never": "Ключом ещё не пользовались.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "apiuse.last": "Кілтті соңғы рет пайдаланды: {when}. Қайдан: {from}.",
  "apiuse.never": "Кілтті әлі пайдаланған жоқ.",
};

export const en: SectionDict<typeof ru> = {
  "apiuse.last": "The key was last used: {when}. From: {from}.",
  "apiuse.never": "The key has not been used yet.",
};

export const uz: SectionDict<typeof ru> = {
  "apiuse.last": "Kalitdan oxirgi marta foydalanildi: {when}. Qayerdan: {from}.",
  "apiuse.never": "Kalitdan hali foydalanilmagan.",
};
