import type { SectionDict } from "../section";

/** Ошибки и сообщения сервера для продавца (UserError и ответы действий): errors-vip. */
export const ru = {
  // ошибки (UserError)
  "err.vip.connectBotFirst": "Сначала подключите VIP-бота — токен в разделе «VIP-бот».",
  "err.vip.botTaken":
    "Бот @{username} уже подключён к магазину «{shop}». Сначала отключите его там.",
  "err.vip.tariffHasSubscriptions": "По тарифу есть подписки — выключите его, а не удаляйте.",
  "err.vip.tariffNotFound": "Тариф не найден",
  "err.vip.subscriptionNotFound": "Подписка не найдена",
  "err.vip.alreadyActive": "Подписка уже активна",
  "err.vip.confirmOnlyPending": "Подтвердить можно только заявку «ожидает оплаты»",
  "err.vip.groupIdMissingInSettings": "Не настроен ID VIP-группы в настройках",
  "err.vip.groupIdMissing": "Не настроен ID VIP-группы",
  "err.vip.cronGroupIdMissing": "vip_group_id не настроен в настройках VIP",
  "err.vip.inviteFailed":
    "Не удалось создать ссылку-приглашение. Убедитесь, что бот — админ группы.",
  "err.vip.updateFailed": "Ошибка обновления: {error}",
  "err.vip.processedByAnotherAdmin": "Заявку уже обработал другой администратор",
  "err.vip.linkSaveFailed": "Ошибка сохранения ссылки: {error}",
  "err.vip.daysRequired": "Укажите число дней",
  "err.vip.daysNonZero": "Укажите число дней, отличное от нуля",
  "err.vip.cannotShortenExpired":
    "Нельзя уменьшить истёкшую подписку. Сначала продлите или создайте новую.",
  "err.vip.resendOnlyActive": "Переотправить ссылку можно только для активной подписки",
  "err.vip.alreadyInGroup": "Пользователь уже состоит в VIP-группе — ссылка не нужна",
  "err.vip.resendUndelivered":
    "Ссылка создана и сохранена, но сообщение не доставлено — возможно, пользователь заблокировал бота.",
  "err.vip.kickFailed": "Не удалось исключить из группы (бот админ? право ban users?)",
  // результаты действий
  "msg.vip.confirmed": "Подписка подтверждена, ссылка отправлена.",
  "msg.vip.confirmedUndelivered":
    "Подписка активна, но сообщение покупателю не доставлено — используйте «Переотправить ссылку».",
  "msg.vip.alreadyProcessed": "Заявка уже обработана.",
  "msg.vip.rejected": "Заявка отклонена.",
  "msg.vip.linkResent": "Новая ссылка отправлена.",
  "msg.vip.excluded": "Участник исключён из группы.",
  "msg.vip.deleted": "Подписка удалена.",
  "msg.vip.deletedWithProfile": "Подписка удалена, профиль участника забыт.",
  "msg.vip.ended": "Подписка завершена.",
  "msg.vip.extended": "Срок изменён: до {date}.",
  // предупреждения ручного добавления
  "msg.vip.warn.notInGroup":
    "Пользователь не найден в VIP-группе. Подписка создана; ссылка уйдёт, если он писал боту.",
  "msg.vip.warn.noGroup": "VIP-группа не настроена — инвайт не отправлен.",
  "msg.vip.warn.undelivered":
    "Сообщение пользователю не доставлено (не писал боту или заблокировал). Ссылка сохранена — используйте «Переотправить».",
} as const;

export const kk: SectionDict<typeof ru> = {
  "err.vip.connectBotFirst": "Алдымен VIP-ботты қосыңыз — токен «VIP-бот» бөлімінде.",
  "err.vip.botTaken":
    "@{username} боты «{shop}» дүкеніне қосылған. Алдымен оны сол жерде ажыратыңыз.",
  "err.vip.tariffHasSubscriptions":
    "Бұл тариф бойынша жазылымдар бар — оны жоймай, өшіріп қойыңыз.",
  "err.vip.tariffNotFound": "Тариф табылмады",
  "err.vip.subscriptionNotFound": "Жазылым табылмады",
  "err.vip.alreadyActive": "Жазылым әлдеқашан белсенді",
  "err.vip.confirmOnlyPending": "Тек «төлем күтуде» өтінімін растауға болады",
  "err.vip.groupIdMissingInSettings": "Баптауларда VIP-топтың ID-і көрсетілмеген",
  "err.vip.groupIdMissing": "VIP-топтың ID-і көрсетілмеген",
  "err.vip.cronGroupIdMissing": "VIP баптауларында VIP-топтың ID-і (vip_group_id) көрсетілмеген",
  "err.vip.inviteFailed":
    "Шақыру сілтемесін жасау мүмкін болмады. Бот топтың әкімшісі екенін тексеріңіз.",
  "err.vip.updateFailed": "Жаңарту қатесі: {error}",
  "err.vip.processedByAnotherAdmin": "Өтінімді басқа әкімші өңдеп қойған",
  "err.vip.linkSaveFailed": "Сілтемені сақтау қатесі: {error}",
  "err.vip.daysRequired": "Күн санын көрсетіңіз",
  "err.vip.daysNonZero": "Нөлден өзге күн санын көрсетіңіз",
  "err.vip.cannotShortenExpired":
    "Мерзімі біткен жазылымды қысқартуға болмайды. Алдымен ұзартыңыз немесе жаңасын жасаңыз.",
  "err.vip.resendOnlyActive": "Сілтемені тек белсенді жазылым үшін қайта жіберуге болады",
  "err.vip.alreadyInGroup": "Пайдаланушы VIP-топта бар — сілтеме қажет емес",
  "err.vip.resendUndelivered":
    "Сілтеме жасалып, сақталды, бірақ хабарлама жеткізілмеді — пайдаланушы ботты бұғаттаған болуы мүмкін.",
  "err.vip.kickFailed":
    "Топтан шығару мүмкін болмады (бот әкімші ме? қатысушыларды шығару құқығы бар ма?)",
  "msg.vip.confirmed": "Жазылым расталды, сілтеме жіберілді.",
  "msg.vip.confirmedUndelivered":
    "Жазылым белсенді, бірақ хабарлама сатып алушыға жеткізілмеді — «Сілтемені қайта жіберу» батырмасын пайдаланыңыз.",
  "msg.vip.alreadyProcessed": "Өтінім әлдеқашан өңделген.",
  "msg.vip.rejected": "Өтінім қабылданбады.",
  "msg.vip.linkResent": "Жаңа сілтеме жіберілді.",
  "msg.vip.excluded": "Қатысушы топтан шығарылды.",
  "msg.vip.deleted": "Жазылым жойылды.",
  "msg.vip.deletedWithProfile": "Жазылым жойылды, қатысушының профилі өшірілді.",
  "msg.vip.ended": "Жазылым аяқталды.",
  "msg.vip.extended": "Мерзім өзгертілді: {date} дейін.",
  "msg.vip.warn.notInGroup":
    "Пайдаланушы VIP-топтан табылмады. Жазылым жасалды; ол ботқа жазған болса, сілтеме жіберіледі.",
  "msg.vip.warn.noGroup": "VIP-топ бапталмаған — шақыру жіберілмеді.",
  "msg.vip.warn.undelivered":
    "Хабарлама пайдаланушыға жеткізілмеді (ботқа жазбаған немесе бұғаттаған). Сілтеме сақталды — «Қайта жіберу» батырмасын пайдаланыңыз.",
};

export const en: SectionDict<typeof ru> = {
  "err.vip.connectBotFirst": "Connect the VIP bot first — add its token in the “VIP bot” section.",
  "err.vip.botTaken":
    "The bot @{username} is already connected to the shop “{shop}”. Disconnect it there first.",
  "err.vip.tariffHasSubscriptions":
    "This tariff has subscriptions — turn it off instead of deleting it.",
  "err.vip.tariffNotFound": "Tariff not found",
  "err.vip.subscriptionNotFound": "Subscription not found",
  "err.vip.alreadyActive": "The subscription is already active",
  "err.vip.confirmOnlyPending": "Only requests “awaiting payment” can be confirmed",
  "err.vip.groupIdMissingInSettings": "The VIP group ID is not set in the settings",
  "err.vip.groupIdMissing": "The VIP group ID is not set",
  "err.vip.cronGroupIdMissing": "The VIP group ID (vip_group_id) is not set in the VIP settings",
  "err.vip.inviteFailed":
    "Couldn’t create an invite link. Make sure the bot is an admin of the group.",
  "err.vip.updateFailed": "Update failed: {error}",
  "err.vip.processedByAnotherAdmin": "Another admin has already processed this request",
  "err.vip.linkSaveFailed": "Failed to save the link: {error}",
  "err.vip.daysRequired": "Enter the number of days",
  "err.vip.daysNonZero": "Enter a non-zero number of days",
  "err.vip.cannotShortenExpired":
    "An expired subscription can’t be shortened. Extend it or create a new one first.",
  "err.vip.resendOnlyActive": "The link can only be resent for an active subscription",
  "err.vip.alreadyInGroup": "The user is already in the VIP group — no link needed",
  "err.vip.resendUndelivered":
    "The link was created and saved, but the message wasn’t delivered — the user may have blocked the bot.",
  "err.vip.kickFailed":
    "Couldn’t remove from the group (is the bot an admin? does it have the right to ban users?)",
  "msg.vip.confirmed": "Subscription confirmed, link sent.",
  "msg.vip.confirmedUndelivered":
    "The subscription is active, but the message to the customer wasn’t delivered — use “Resend link”.",
  "msg.vip.alreadyProcessed": "The request has already been processed.",
  "msg.vip.rejected": "Request rejected.",
  "msg.vip.linkResent": "New link sent.",
  "msg.vip.excluded": "Member removed from the group.",
  "msg.vip.deleted": "Subscription deleted.",
  "msg.vip.deletedWithProfile": "Subscription deleted, the member’s profile has been forgotten.",
  "msg.vip.ended": "Subscription ended.",
  "msg.vip.extended": "Term changed: until {date}.",
  "msg.vip.warn.notInGroup":
    "User not found in the VIP group. The subscription was created; the link will be sent if they have messaged the bot.",
  "msg.vip.warn.noGroup": "The VIP group isn’t set up — no invite was sent.",
  "msg.vip.warn.undelivered":
    "The message wasn’t delivered to the user (they haven’t messaged the bot or have blocked it). The link is saved — use “Resend”.",
};

export const uz: SectionDict<typeof ru> = {
  "err.vip.connectBotFirst": "Avval VIP-botni ulang — token «VIP-bot» boʻlimida kiritiladi.",
  "err.vip.botTaken": "@{username} boti «{shop}» doʻkoniga ulangan. Avval uni oʻsha yerda uzing.",
  "err.vip.tariffHasSubscriptions":
    "Bu tarif boʻyicha obunalar bor — uni oʻchirib tashlamang, faolsizlantiring.",
  "err.vip.tariffNotFound": "Tarif topilmadi",
  "err.vip.subscriptionNotFound": "Obuna topilmadi",
  "err.vip.alreadyActive": "Obuna allaqachon faol",
  "err.vip.confirmOnlyPending": "Faqat «toʻlov kutilmoqda» holatidagi arizani tasdiqlash mumkin",
  "err.vip.groupIdMissingInSettings": "Sozlamalarda VIP-guruh ID-si koʻrsatilmagan",
  "err.vip.groupIdMissing": "VIP-guruh ID-si koʻrsatilmagan",
  "err.vip.cronGroupIdMissing": "VIP sozlamalarida VIP-guruh ID-si (vip_group_id) koʻrsatilmagan",
  "err.vip.inviteFailed":
    "Taklif havolasini yaratib boʻlmadi. Bot guruhda administrator ekanini tekshiring.",
  "err.vip.updateFailed": "Yangilashda xato: {error}",
  "err.vip.processedByAnotherAdmin": "Arizani boshqa administrator allaqachon koʻrib chiqqan",
  "err.vip.linkSaveFailed": "Havolani saqlashda xato: {error}",
  "err.vip.daysRequired": "Kunlar sonini kiriting",
  "err.vip.daysNonZero": "Noldan farqli kunlar sonini kiriting",
  "err.vip.cannotShortenExpired":
    "Muddati tugagan obunani qisqartirib boʻlmaydi. Avval uni uzaytiring yoki yangisini yarating.",
  "err.vip.resendOnlyActive": "Havolani faqat faol obuna uchun qayta yuborish mumkin",
  "err.vip.alreadyInGroup": "Foydalanuvchi allaqachon VIP-guruhda — havola kerak emas",
  "err.vip.resendUndelivered":
    "Havola yaratildi va saqlandi, lekin xabar yetkazilmadi — ehtimol, foydalanuvchi botni bloklagan.",
  "err.vip.kickFailed":
    "Guruhdan chiqarib boʻlmadi (bot administratormi? aʼzolarni chiqarish huquqi bormi?)",
  "msg.vip.confirmed": "Obuna tasdiqlandi, havola yuborildi.",
  "msg.vip.confirmedUndelivered":
    "Obuna faol, lekin xaridorga xabar yetkazilmadi — «Havolani qayta yuborish» tugmasidan foydalaning.",
  "msg.vip.alreadyProcessed": "Ariza allaqachon koʻrib chiqilgan.",
  "msg.vip.rejected": "Ariza rad etildi.",
  "msg.vip.linkResent": "Yangi havola yuborildi.",
  "msg.vip.excluded": "Aʼzo guruhdan chiqarildi.",
  "msg.vip.deleted": "Obuna oʻchirildi.",
  "msg.vip.deletedWithProfile": "Obuna oʻchirildi, aʼzoning profili ham oʻchirildi.",
  "msg.vip.ended": "Obuna yakunlandi.",
  "msg.vip.extended": "Muddat oʻzgartirildi: {date} gacha.",
  "msg.vip.warn.notInGroup":
    "Foydalanuvchi VIP-guruhda topilmadi. Obuna yaratildi; agar u botga yozgan boʻlsa, havola yuboriladi.",
  "msg.vip.warn.noGroup": "VIP-guruh sozlanmagan — taklif havolasi yuborilmadi.",
  "msg.vip.warn.undelivered":
    "Xabar foydalanuvchiga yetkazilmadi (botga yozmagan yoki uni bloklagan). Havola saqlandi — «Qayta yuborish» tugmasidan foydalaning.",
};
