import type { SectionDict } from "../section";

/** Наборы товаров (Н1): карточка набора в товаре и ошибки состава. */
export const ru = {
  "bundle.card": "Набор товаров",
  "bundle.hint":
    "Набор — товар со своей ценой, который состоит из других товаров, например «шампунь + бальзам». Цену набора задайте в этой карточке выше. Только физические товары; набор не входит в набор.",
  "bundle.on": "Это набор",
  "bundle.addLabel": "Добавить товар в набор",
  "bundle.qty": "Штук",
  "bundle.variant": "Вариант",
  "bundle.pickVariant": "Выберите вариант",
  "bundle.add": "Добавить",
  "bundle.remove": "Убрать",
  "bundle.empty": "Добавьте хотя бы один товар.",
  "bundle.saved": "Состав сохранён",
  "bundle.notPhysical": "«{name}» не физический товар — в набор он не входит.",
  "bundle.state.hidden": "скрыт",
  "bundle.state.deleted": "удалён",
  "bundle.state.noVariant": "вариант удалён или не выбран",
  "bundle.deletedName": "Товар удалён",
  "bundle.unavailable":
    "Набор недоступен покупателям, пока в составе есть скрытый или удалённый товар. Исправьте состав.",
  "bundle.saving": "По отдельности {sum}, выгода покупателя {saving}.",
  "bundle.noSaving": "По отдельности {sum} — набор не дешевле, выгоды у покупателя нет.",
  "bundle.noCompare": "Выгоду не посчитать: у части товаров нет цены в валюте набора.",
  "err.bundle.tooMany": "В наборе не больше {n} позиций.",
  "err.bundle.badQty": "Количество в наборе — целое от 1 до {n}.",
  "err.bundle.nested": "Набор не может входить в набор.",
  "err.bundle.nestedIn": "Этот товар уже входит в другой набор — набор не может входить в набор.",
  "err.bundle.noProduct": "Товар не найден.",
  "err.bundle.notPhysical": "Набор — физический товар: в карточке выберите «Физический».",
  "err.bundle.componentNotPhysical":
    "В набор входят только физические товары: «{name}» — не физический.",
  "err.bundle.noVariant": "Вариант товара «{name}» не найден.",
  "err.bundle.variantRequired": "У товара «{name}» есть варианты — выберите вариант для набора.",
} as const;

export const kk: SectionDict<typeof ru> = {
  "bundle.card": "Тауар жиынтығы",
  "bundle.hint":
    "Жиынтық — өз бағасы бар, басқа тауарлардан тұратын тауар, мысалы «шампунь + бальзам». Жиынтық бағасын жоғарыдағы осы карточкада көрсетіңіз. Тек физикалық тауарлар; жиынтық жиынтыққа кірмейді.",
  "bundle.on": "Бұл жиынтық",
  "bundle.addLabel": "Жиынтыққа тауар қосу",
  "bundle.qty": "Саны",
  "bundle.variant": "Нұсқа",
  "bundle.pickVariant": "Нұсқаны таңдаңыз",
  "bundle.add": "Қосу",
  "bundle.remove": "Алып тастау",
  "bundle.empty": "Кемінде бір тауар қосыңыз.",
  "bundle.saved": "Құрам сақталды",
  "bundle.notPhysical": "«{name}» физикалық тауар емес — жиынтыққа кірмейді.",
  "bundle.state.hidden": "жасырылған",
  "bundle.state.deleted": "жойылған",
  "bundle.state.noVariant": "нұсқа жойылған немесе таңдалмаған",
  "bundle.deletedName": "Тауар жойылған",
  "bundle.unavailable":
    "Құрамда жасырылған немесе жойылған тауар болса, жиынтық сатып алушыларға қолжетімсіз. Құрамды түзетіңіз.",
  "bundle.saving": "Жеке-жеке {sum}, сатып алушының үнемі {saving}.",
  "bundle.noSaving": "Жеке-жеке {sum} — жиынтық арзан емес, сатып алушыға үнем жоқ.",
  "bundle.noCompare":
    "Үнемді есептеу мүмкін емес: кейбір тауарлардың жиынтық валютасында бағасы жоқ.",
  "err.bundle.tooMany": "Жиынтықта {n} позициядан артық болмайды.",
  "err.bundle.badQty": "Жиынтықтағы саны — 1-ден {n}-ге дейінгі бүтін сан.",
  "err.bundle.nested": "Жиынтық жиынтыққа кіре алмайды.",
  "err.bundle.nestedIn": "Бұл тауар басқа жиынтыққа кіреді — жиынтық жиынтыққа кіре алмайды.",
  "err.bundle.noProduct": "Тауар табылмады.",
  "err.bundle.notPhysical": "Жиынтық — физикалық тауар: карточкада «Физикалық» таңдаңыз.",
  "err.bundle.componentNotPhysical":
    "Жиынтыққа тек физикалық тауарлар кіреді: «{name}» физикалық емес.",
  "err.bundle.noVariant": "«{name}» тауарының нұсқасы табылмады.",
  "err.bundle.variantRequired": "«{name}» тауарында нұсқалар бар — жиынтыққа нұсқаны таңдаңыз.",
};

export const en: SectionDict<typeof ru> = {
  "bundle.card": "Product bundle",
  "bundle.hint":
    "A bundle is a product with its own price that consists of other products, e.g. “shampoo + conditioner”. Set the bundle price in this card above. Physical products only; a bundle cannot contain a bundle.",
  "bundle.on": "This is a bundle",
  "bundle.addLabel": "Add a product to the bundle",
  "bundle.qty": "Qty",
  "bundle.variant": "Variant",
  "bundle.pickVariant": "Choose a variant",
  "bundle.add": "Add",
  "bundle.remove": "Remove",
  "bundle.empty": "Add at least one product.",
  "bundle.saved": "Contents saved",
  "bundle.notPhysical": "“{name}” is not a physical product and cannot go into a bundle.",
  "bundle.state.hidden": "hidden",
  "bundle.state.deleted": "deleted",
  "bundle.state.noVariant": "variant deleted or not chosen",
  "bundle.deletedName": "Product deleted",
  "bundle.unavailable":
    "The bundle is unavailable to buyers while it contains a hidden or deleted product. Fix the contents.",
  "bundle.saving": "Separately {sum}, the buyer saves {saving}.",
  "bundle.noSaving": "Separately {sum} — the bundle is not cheaper, the buyer saves nothing.",
  "bundle.noCompare":
    "Savings cannot be calculated: some products have no price in the bundle currency.",
  "err.bundle.tooMany": "A bundle holds at most {n} items.",
  "err.bundle.badQty": "Quantity in a bundle is a whole number from 1 to {n}.",
  "err.bundle.nested": "A bundle cannot contain a bundle.",
  "err.bundle.nestedIn":
    "This product is already part of another bundle — a bundle cannot contain a bundle.",
  "err.bundle.noProduct": "Product not found.",
  "err.bundle.notPhysical": "A bundle is a physical product: choose “Physical” in the card.",
  "err.bundle.componentNotPhysical":
    "Only physical products go into a bundle: “{name}” is not physical.",
  "err.bundle.noVariant": "Variant of “{name}” not found.",
  "err.bundle.variantRequired": "“{name}” has variants — choose a variant for the bundle.",
};

export const uz: SectionDict<typeof ru> = {
  "bundle.card": "Mahsulotlar toʻplami",
  "bundle.hint":
    "Toʻplam — oʻz narxiga ega, boshqa mahsulotlardan iborat mahsulot, masalan “shampun + balzam”. Toʻplam narxini yuqoridagi shu kartada belgilang. Faqat jismoniy mahsulotlar; toʻplam toʻplamga kirmaydi.",
  "bundle.on": "Bu toʻplam",
  "bundle.addLabel": "Toʻplamga mahsulot qoʻshish",
  "bundle.qty": "Soni",
  "bundle.variant": "Variant",
  "bundle.pickVariant": "Variantni tanlang",
  "bundle.add": "Qoʻshish",
  "bundle.remove": "Olib tashlash",
  "bundle.empty": "Kamida bitta mahsulot qoʻshing.",
  "bundle.saved": "Tarkib saqlandi",
  "bundle.notPhysical": "“{name}” jismoniy mahsulot emas — toʻplamga kirmaydi.",
  "bundle.state.hidden": "yashirilgan",
  "bundle.state.deleted": "oʻchirilgan",
  "bundle.state.noVariant": "variant oʻchirilgan yoki tanlanmagan",
  "bundle.deletedName": "Mahsulot oʻchirilgan",
  "bundle.unavailable":
    "Tarkibda yashirilgan yoki oʻchirilgan mahsulot boʻlsa, toʻplam xaridorlarga mavjud emas. Tarkibni tuzating.",
  "bundle.saving": "Alohida {sum}, xaridorning tejami {saving}.",
  "bundle.noSaving": "Alohida {sum} — toʻplam arzon emas, xaridorga tejam yoʻq.",
  "bundle.noCompare":
    "Tejamni hisoblab boʻlmaydi: baʼzi mahsulotlarning toʻplam valyutasida narxi yoʻq.",
  "err.bundle.tooMany": "Toʻplamda {n} tadan koʻp pozitsiya boʻlmaydi.",
  "err.bundle.badQty": "Toʻplamdagi soni — 1 dan {n} gacha butun son.",
  "err.bundle.nested": "Toʻplam toʻplamga kira olmaydi.",
  "err.bundle.nestedIn": "Bu mahsulot boshqa toʻplamga kiradi — toʻplam toʻplamga kira olmaydi.",
  "err.bundle.noProduct": "Mahsulot topilmadi.",
  "err.bundle.notPhysical": "Toʻplam — jismoniy mahsulot: kartada “Jismoniy”ni tanlang.",
  "err.bundle.componentNotPhysical":
    "Toʻplamga faqat jismoniy mahsulotlar kiradi: “{name}” jismoniy emas.",
  "err.bundle.noVariant": "“{name}” mahsulotining varianti topilmadi.",
  "err.bundle.variantRequired":
    "“{name}” mahsulotida variantlar bor — toʻplam uchun variantni tanlang.",
};
