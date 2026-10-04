import type { SectionDict } from "../section";

/** «Почему бот так ответил» во «Входящих»: раскрывающаяся строка под ответом бота. */
export const ru = {
  "chatReason.title": "Почему бот так ответил",
  "chatReason.step": "Шаг",
  "chatReason.cmd": "Команда",
  "chatReason.cancel": "Слово отмены",
  "chatReason.parsed": "Разобрано как",
  "chatReason.skipped": "Пропущено",
  "chatReason.trigger": "Слово-вызов",
  "chatReason.stale": "Шаг устарел",
  "chatReason.button": "Кнопка",
  "chatReason.source": "Источник",
  "chatReason.handoff": "Передано менеджеру",
  "chatReason.rule": "Правило",
  "chatReason.other": "Причина",
  "chatReason.empty": "Причина не записана.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "chatReason.title": "Бот неге олай жауап берді",
  "chatReason.step": "Қадам",
  "chatReason.cmd": "Команда",
  "chatReason.cancel": "Бас тарту сөзі",
  "chatReason.parsed": "Былай танылды",
  "chatReason.skipped": "Өткізілді",
  "chatReason.trigger": "Шақыру сөзі",
  "chatReason.stale": "Қадам ескірген",
  "chatReason.button": "Батырма",
  "chatReason.source": "Көзі",
  "chatReason.handoff": "Менеджерге берілді",
  "chatReason.rule": "Ереже",
  "chatReason.other": "Себеп",
  "chatReason.empty": "Себеп жазылмаған.",
};

export const en: SectionDict<typeof ru> = {
  "chatReason.title": "Why the bot replied this way",
  "chatReason.step": "Step",
  "chatReason.cmd": "Command",
  "chatReason.cancel": "Cancel word",
  "chatReason.parsed": "Understood as",
  "chatReason.skipped": "Skipped",
  "chatReason.trigger": "Trigger word",
  "chatReason.stale": "Step expired",
  "chatReason.button": "Button",
  "chatReason.source": "Source",
  "chatReason.handoff": "Handed to a manager",
  "chatReason.rule": "Rule",
  "chatReason.other": "Reason",
  "chatReason.empty": "No reason recorded.",
};

export const uz: SectionDict<typeof ru> = {
  "chatReason.title": "Bot nega bunday javob berdi",
  "chatReason.step": "Qadam",
  "chatReason.cmd": "Buyruq",
  "chatReason.cancel": "Bekor qilish soʻzi",
  "chatReason.parsed": "Shunday tushunildi",
  "chatReason.skipped": "Oʻtkazib yuborildi",
  "chatReason.trigger": "Chaqiruv soʻzi",
  "chatReason.stale": "Qadam eskirgan",
  "chatReason.button": "Tugma",
  "chatReason.source": "Manba",
  "chatReason.handoff": "Menejerga berildi",
  "chatReason.rule": "Qoida",
  "chatReason.other": "Sabab",
  "chatReason.empty": "Sabab yozilmagan.",
};
