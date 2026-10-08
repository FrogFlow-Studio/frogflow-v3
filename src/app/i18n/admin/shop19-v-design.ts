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
  "settings.design.photo": "Форма фото в каталоге",
  "settings.design.photoHint":
    "Как фото товара выглядит в карточках каталога, «Похожих», «Недавно смотрели», избранном и на странице товара. Обложка магазина и превью ссылок не меняются.",
  "settings.design.photo.square": "Квадрат",
  "settings.design.photo.squareHint":
    "Как раньше: фото заполняет квадрат, края вертикальных фото обрезаются.",
  "settings.design.photo.portrait": "Вертикальная 4:5",
  "settings.design.photo.portraitHint":
    "Карточка выше, фото 4:5 видно целиком. Квадратные фото вписываются с фоном, не растягиваются. На экране помещается чуть меньше товаров.",
  "settings.design.photo.contain": "Целиком",
  "settings.design.photo.containHint":
    "Фото любой формы видно целиком внутри квадрата, свободное место — фон. Для каталогов со смешанными фото.",
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
  "settings.design.photo": "Каталогтағы фото пішіні",
  "settings.design.photoHint":
    "Тауар фотосы каталог карточкаларында, «Ұқсастарда», «Жақында қаралғандарда», таңдаулыларда және тауар бетінде қалай көрінеді. Дүкен мұқабасы мен сілтеме алдын ала көрінісі өзгермейді.",
  "settings.design.photo.square": "Шаршы",
  "settings.design.photo.squareHint":
    "Бұрынғыдай: фото шаршыны толтырады, тік фотолардың шеттері кесіледі.",
  "settings.design.photo.portrait": "Тік 4:5",
  "settings.design.photo.portraitHint":
    "Карточка биігірек, 4:5 фото толық көрінеді. Шаршы фотолар фонмен сыйғызылады, созылмайды. Экранға тауар сәл азырақ сыяды.",
  "settings.design.photo.contain": "Толық",
  "settings.design.photo.containHint":
    "Кез келген пішіндегі фото шаршы ішінде толық көрінеді, бос орын — фон. Аралас фотолары бар каталогтарға.",
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
  "settings.design.photo": "Photo shape in the catalogue",
  "settings.design.photoHint":
    "How product photos look on catalogue cards, “Similar”, “Recently viewed”, favourites and the product page. The shop cover and link previews do not change.",
  "settings.design.photo.square": "Square",
  "settings.design.photo.squareHint":
    "As before: the photo fills a square, edges of tall photos are cropped.",
  "settings.design.photo.portrait": "Portrait 4:5",
  "settings.design.photo.portraitHint":
    "Taller cards, 4:5 photos are shown in full. Square photos fit with a background, never stretched. Slightly fewer products fit on screen.",
  "settings.design.photo.contain": "Whole photo",
  "settings.design.photo.containHint":
    "Photos of any shape are shown in full inside a square, the free space is background. For catalogues with mixed photos.",
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
  "settings.design.photo": "Katalogdagi surat shakli",
  "settings.design.photoHint":
    "Mahsulot surati katalog kartochkalarida, «O‘xshash», «Yaqinda ko‘rilgan», sevimlilar va mahsulot sahifasida qanday ko‘rinadi. Do‘kon muqovasi va havola ko‘rinishi o‘zgarmaydi.",
  "settings.design.photo.square": "Kvadrat",
  "settings.design.photo.squareHint":
    "Avvalgidek: surat kvadratni to‘ldiradi, tik suratlarning chetlari kesiladi.",
  "settings.design.photo.portrait": "Tik 4:5",
  "settings.design.photo.portraitHint":
    "Kartochka balandroq, 4:5 surat to‘liq ko‘rinadi. Kvadrat suratlar fon bilan joylashadi, cho‘zilmaydi. Ekranga biroz kamroq mahsulot sig‘adi.",
  "settings.design.photo.contain": "To‘liq",
  "settings.design.photo.containHint":
    "Har qanday shakldagi surat kvadrat ichida to‘liq ko‘rinadi, bo‘sh joy — fon. Aralash suratli kataloglar uchun.",
};
