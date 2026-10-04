import type { SectionDict } from "../section";

/** Оформление витрины (В3): тема, обложка, блоки главной. */
export const ru = {
  "settings.design.title": "Оформление витрины",
  "settings.design.intro":
    "Выберите готовую тему, включите обложку и расставьте блоки главной. Свой цвет акцента (в основных настройках) остаётся поверх темы. Изменения видны покупателям сразу после сохранения.",
  "settings.design.theme": "Тема",
  "settings.design.theme.fresh": "Свежая",
  "settings.design.theme.warm": "Тёплая",
  "settings.design.theme.classic": "Классика",
  "settings.design.cover": "Обложка магазина",
  "settings.design.coverHint":
    "Крупная картинка над каталогом: берётся фото первого товара в продаже. Пока в магазине нет фото, обложка не показывается.",
  "settings.design.blocks": "Блоки главной",
  "settings.design.blocksHint":
    "Отмеченные блоки идут над каталогом в этом порядке. Пустой блок (нет хитов, наборов, отзывов) покупателю не виден. «Хиты» — товары с одобренными отзывами.",
  "settings.design.block.new": "Новинки",
  "settings.design.block.hits": "Хиты",
  "settings.design.block.sets": "Наборы",
  "settings.design.block.reviews": "Отзывы",
  "settings.design.up": "Поднять блок «{name}»",
  "settings.design.down": "Опустить блок «{name}»",
  "settings.design.ownerOnly": "Оформление меняет владелец магазина.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "settings.design.title": "Витрина безендіру",
  "settings.design.intro":
    "Дайын тақырыпты таңдаңыз, мұқабаны қосыңыз және басты беттің блоктарын орналастырыңыз. Өз акцент түсіңіз (негізгі баптауларда) тақырып үстінен қалады. Өзгерістер сақталғаннан кейін бірден көрінеді.",
  "settings.design.theme": "Тақырып",
  "settings.design.theme.fresh": "Балғын",
  "settings.design.theme.warm": "Жылы",
  "settings.design.theme.classic": "Классика",
  "settings.design.cover": "Дүкен мұқабасы",
  "settings.design.coverHint":
    "Каталог үстіндегі үлкен сурет: сатылымдағы бірінші тауардың фотосы алынады. Дүкенде фото болмаса, мұқаба көрсетілмейді.",
  "settings.design.blocks": "Басты бет блоктары",
  "settings.design.blocksHint":
    "Белгіленген блоктар каталог үстінде осы ретпен тұрады. Бос блок (хит, жиынтық, пікір жоқ) сатып алушыға көрінбейді. «Хиттер» — мақұлданған пікірлері бар тауарлар.",
  "settings.design.block.new": "Жаңалықтар",
  "settings.design.block.hits": "Хиттер",
  "settings.design.block.sets": "Жиынтықтар",
  "settings.design.block.reviews": "Пікірлер",
  "settings.design.up": "«{name}» блогын жоғары жылжыту",
  "settings.design.down": "«{name}» блогын төмен жылжыту",
  "settings.design.ownerOnly": "Безендіруді дүкен иесі өзгертеді.",
};

export const en: SectionDict<typeof ru> = {
  "settings.design.title": "Storefront look",
  "settings.design.intro":
    "Pick a ready-made theme, turn the cover on and arrange the home blocks. Your own accent colour (in the main settings) stays on top of the theme. Changes are visible to buyers right after saving.",
  "settings.design.theme": "Theme",
  "settings.design.theme.fresh": "Fresh",
  "settings.design.theme.warm": "Warm",
  "settings.design.theme.classic": "Classic",
  "settings.design.cover": "Shop cover",
  "settings.design.coverHint":
    "A large picture above the catalogue: the photo of the first product on sale. Without any photo the cover is not shown.",
  "settings.design.blocks": "Home blocks",
  "settings.design.blocksHint":
    "Ticked blocks go above the catalogue in this order. An empty block (no hits, sets or reviews) is not shown to buyers. “Best sellers” are products with approved reviews.",
  "settings.design.block.new": "New arrivals",
  "settings.design.block.hits": "Best sellers",
  "settings.design.block.sets": "Sets",
  "settings.design.block.reviews": "Reviews",
  "settings.design.up": "Move “{name}” up",
  "settings.design.down": "Move “{name}” down",
  "settings.design.ownerOnly": "Only the shop owner can change the look.",
};

export const uz: SectionDict<typeof ru> = {
  "settings.design.title": "Vitrina dizayni",
  "settings.design.intro":
    "Tayyor mavzuni tanlang, muqovani yoqing va bosh sahifa bloklarini joylashtiring. O‘z urg‘u rangingiz (asosiy sozlamalarda) mavzu ustida qoladi. O‘zgarishlar saqlangandan so‘ng darhol ko‘rinadi.",
  "settings.design.theme": "Mavzu",
  "settings.design.theme.fresh": "Yangi",
  "settings.design.theme.warm": "Iliq",
  "settings.design.theme.classic": "Klassika",
  "settings.design.cover": "Do‘kon muqovasi",
  "settings.design.coverHint":
    "Katalog ustidagi katta rasm: sotuvdagi birinchi mahsulotning surati olinadi. Surat bo‘lmasa, muqova ko‘rsatilmaydi.",
  "settings.design.blocks": "Bosh sahifa bloklari",
  "settings.design.blocksHint":
    "Belgilangan bloklar katalog ustida shu tartibda turadi. Bo‘sh blok (xit, to‘plam, fikr yo‘q) xaridorga ko‘rinmaydi. «Xitlar» — tasdiqlangan fikrli mahsulotlar.",
  "settings.design.block.new": "Yangiliklar",
  "settings.design.block.hits": "Xitlar",
  "settings.design.block.sets": "To‘plamlar",
  "settings.design.block.reviews": "Fikrlar",
  "settings.design.up": "«{name}» blokini yuqoriga",
  "settings.design.down": "«{name}» blokini pastga",
  "settings.design.ownerOnly": "Dizaynni do‘kon egasi o‘zgartiradi.",
};
