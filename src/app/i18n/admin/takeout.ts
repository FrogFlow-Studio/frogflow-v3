import type { SectionDict } from "../section";

/** «Забрать мои данные» в настройках: архив магазина по ссылке на 24 часа (core/export/takeout). */
export const ru = {
  "takeout.title": "Забрать мои данные",
  "takeout.hint":
    "Архив ZIP: заказы и их позиции, покупатели, каталог (CSV для Excel) и настройки магазина без паролей и токенов. Ссылка действует 24 часа.",
  "takeout.make": "Получить ссылку на архив",
  "takeout.ready": "Ссылка готова. Действует до {date}.",
  "takeout.download": "Скачать архив",
  "takeout.warn":
    "В архиве контакты ваших покупателей. Любой, у кого есть ссылка, сможет скачать архив до конца срока, поэтому не пересылайте её посторонним.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "takeout.title": "Деректерімді алу",
  "takeout.hint":
    "ZIP мұрағат: тапсырыстар мен олардың позициялары, сатып алушылар, каталог (Excel үшін CSV) және құпия сөздері мен токендерсіз дүкен баптаулары. Сілтеме 24 сағат жарамды.",
  "takeout.make": "Мұрағатқа сілтеме алу",
  "takeout.ready": "Сілтеме дайын. {date} дейін жарамды.",
  "takeout.download": "Мұрағатты жүктеу",
  "takeout.warn":
    "Мұрағатта сатып алушыларыңыздың байланыстары бар. Сілтемесі барлардың бәрі мерзім біткенше жүктей алады, сондықтан бөтен адамдарға жібермеңіз.",
};

export const en: SectionDict<typeof ru> = {
  "takeout.title": "Take my data",
  "takeout.hint":
    "A ZIP archive: orders and their items, customers, catalog (CSV for Excel) and shop settings without passwords or tokens. The link is valid for 24 hours.",
  "takeout.make": "Get a link to the archive",
  "takeout.ready": "The link is ready. Valid until {date}.",
  "takeout.download": "Download the archive",
  "takeout.warn":
    "The archive contains your customers' contacts. Anyone with the link can download it until it expires, so do not share it with outsiders.",
};

export const uz: SectionDict<typeof ru> = {
  "takeout.title": "Ma’lumotlarimni olish",
  "takeout.hint":
    "ZIP arxiv: buyurtmalar va ularning pozitsiyalari, xaridorlar, katalog (Excel uchun CSV) va parollar hamda tokenlarsiz do‘kon sozlamalari. Havola 24 soat amal qiladi.",
  "takeout.make": "Arxivga havola olish",
  "takeout.ready": "Havola tayyor. {date} gacha amal qiladi.",
  "takeout.download": "Arxivni yuklab olish",
  "takeout.warn":
    "Arxivda xaridorlaringizning kontaktlari bor. Havolasi bor har kim muddat tugaguncha yuklab olishi mumkin, shuning uchun uni begonalarga yubormang.",
};
