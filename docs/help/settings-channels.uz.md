# Sozlamalar: kanallar

keywords: telegram, bot, token, botfather, instagram, direct, whatsapp, ulash, avtojavob, bot pauzasi, tezkor savollar, tezkor xarid, kanallar
group: guide
order: 420

[To‘lov va sozlamalar](/admin/settings) sahifasidagi «Kanallar» mavzusi: Telegram-bot, Instagram va WhatsApp’ni ulash hamda botning yozishmadagi xatti-harakati. Egasi va administratorlar ulaydi va o‘zgartiradi; qolganlar sozlamalarni tahrirlash huquqisiz ko‘radi.

## Telegram-bot {#telegram}

Do‘konning Telegram’dagi boti. Karta sarlavhasining o‘ng tomonida — holat: «@nomi ishlayapti», botning platforma bilan aloqasi sozlanmagani haqida ogohlantirish yoki «ulanmagan».

1. Telegram’da @BotFather’ni oching, /newbot yuboring va botga nom o‘ylab toping.
2. 123456789:AA… ko‘rinishidagi tokenni nusxalab, maydonga qo‘ying.
3. «Ulash» tugmasini bosing. Platforma tokenni o‘zi tekshiradi va botni sozlaydi.

Botni almashtirgan bo‘lsangiz, yangi tokenni qo‘ying va «Almashtirish»ni bosing. Karta botning platforma bilan aloqasi sozlanmaganini yozsa, o‘sha tokenni yana bir bor qo‘ying.

## Botni tekshirish va tuzatish {#telegram-check}

«Botni tekshirish» bandma-band ko‘radi: token ishlayaptimi, xabarlar do‘konga yetib boryaptimi, kerakli hodisa turlari yoqilganmi va buyruqlar menyusi o‘rnatilganmi. Hech narsani o‘zgartirmaydi.

Biror narsa noto‘g‘ri bo‘lsa, «Tuzatish» paydo bo‘ladi: u xabarlarni yetkazishni, hodisa turlarini va buyruqlar menyusini qaytadan sozlaydi. Telegram rad etsa, sababi tugma ostida yoziladi.

## Bosqichma-bosqich ulash {#channel-wizard}

Instagram va WhatsApp uchun usta (bu modullardan kamida bittasi yoqilgan bo‘lsa bor). Uchta qadam: «1. Akkauntga kiring», «2. Aloqani tekshirish», «3. Sinov xabari».

1. «Instagram’ga kirish» (yoki WhatsApp) tugmasini bosing: kirish sahifasi ochiladi, akkauntga kiring va ruxsat bering, keyin shu yerga qaytasiz.
2. Bir daqiqadan keyin «Tekshirish»ni bosing — usta aloqani tekshiradi.
3. Boshqa akkaunt yoki raqamdan do‘kon akkauntiga istalgan xabar yozing va yana «Tekshirish»ni bosing. Biz hech narsa yubormaymiz, sizning xabaringizni kutamiz.

Qadamda biror narsa noto‘g‘ri bo‘lsa, usta nima qilish kerakligini yozadi: masalan, akkaunt boshqa do‘konga ulangan yoki kirish uchib ketgan va uni takrorlash kerak.

## Instagram va WhatsApp {#instagram-whatsapp}

Ulangan akkauntlar ro‘yxati va «Instagram’ni ulash», «WhatsApp’ni ulash», «Ro‘yxatni yangilash» tugmalari. Akkauntda «ishlayapti» yoki «qayta ulash kerak» (masalan, parol almashtirilgan) ko‘rinadi — shunda uni qayta ulang.

«Uzish» — bot bu akkauntda javob berish va yozishni to‘xtatadi. Yozishmalar, buyurtmalar va xaridorlar saqlanadi. Akkauntni qaytarish uchun uni qayta ulang.

Karta platformada messenjerlarni ulash sozlanmaganini yozsa, operator uni yoqmaguncha tugmalar faol emas.

## Avtojavob · Instagram {#dbot-instagram}

Botning Direct’dagi xatti-harakati. Barcha maydonlar «Saqlash» tugmasi bilan saqlanadi. Do‘kon sotuvsiz SI-maslahatchi sifatida ishlasa, maydonlarning ko‘pi unga ta’sir qilmaydi: uning kaliti va pauzasi — [maslahatchi](/admin/consultant) sahifasida.

## Avtojavob kaliti {#dbot-enabled}

Karta sarlavhasidagi kalit («yoqilgan»). Yoqilgan (standart) — bot kanalda quyidagi qoidalar bo‘yicha javob beradi. O‘chirilgan — bot bu kanalda butunlay jim turadi, barcha xabarlar «Kiruvchi» bo‘limida javobingizni kutadi.

## Nimaga javob berish {#dbot-scope}

- «Faqat buyurtmalar bo‘yicha» (standart) — bot faqat unga murojaat qilinganda javob beradi: «start», «katalog» yoki sizning chaqiruv so‘zingiz, material kodi (masalan #245 yoki kartadagi kalit so‘zlardan biri), tugmalar, buyurtmaga chek — va xaridor u bilan yozishayotgan paytda. Oddiy xabarlarga jim turadi: dialog o‘qilmagan holda qoladi, siz esa ilovada kimga javob berish kerakligini ko‘rasiz.
- «Barcha xabarlarga» — bot har qanday xabarga javob beradi, savollarni sizga uzatadi.

## Buyruqlar va tushunarsiz xabarga javob {#dbot-triggers}

«Xaridor botni chaqiradigan buyruqlar» — vergul bilan o‘z so‘zlaringiz, masalan «buyurtma, prays, sotib olmoqchiman». O‘rnatilgan «katalog», «savat», «sotib olish» har doim ishlaydi.

«Qisqa yoki tushunarsiz xabarga javob» — standart matn o‘rniga o‘z matningiz. Bo‘sh bo‘lsa — standart javob. Bu matn mahsulot qidiruvi, savat va rasmiylashtirish o‘rnini bosmaydi.

## Qo‘lda javob bergandan keyin botning pauzasi {#dbot-pause}

Agar siz xaridorga Instagram yoki WhatsApp ilovasidan o‘zingiz javob bergan bo‘lsangiz, bot bu dialogda tanlangan vaqt jim turadi: «15 daqiqa», «30 daqiqa» (standart), «1 soat» yoki «Kun oxirigacha». Shunday qilib bot suhbatingizni bo‘lmaydi. «Menyu», «savat» buyruqlari va tugmalarni bosish har doim ishlaydi, to‘lov qadamidagi chekni esa bot pauza paytida ham qabul qiladi.

Maslahatchining soatlarda o‘lchanadigan o‘z pauzasi bor; ikkalasidan biri davom etayotganda, u jim turadi.

## Yozishmada nima mavjud {#dbot-features}

«Katalog», «raqam bo‘yicha qidiruv», «savat», «buyurtmani rasmiylashtirish» belgilari — yozishmada do‘konning qaysi qismlari ishlashi. Belgini olib tashlasangiz — bot bu kanal yozishmasida buni qilmaydi, bunday xabarlar esa sizga oddiy savol sifatida yetib keladi.

## Avtomatlashtirish orqali tezkor xarid {#dbot-express}

Faqat Instagram uchun. Yoqilgan (standart) — rils ostidagi «+» yoki kod so‘z qoida mahsulotiga darhol buyurtma rasmiylashtiradi: xaridor «Sotib olish», savat va «Buyurtma berish»siz, summa va to‘lov tugmalari bor bitta xabar oladi. Tezkor xarid faqat «savat» ham, «buyurtmani rasmiylashtirish» ham yoqilganda ishlaydi. O‘chirilgan — xaridor «Sotib olish» tugmasi va savat orqali odatiy yo‘ldan o‘tadi. Postlar ostidagi qoidalar [Instagram](/admin/instagram) bo‘limida sozlanadi.

## Instagram’dagi tezkor savollar {#ice-breakers}

Xaridor Direct’da sizga birinchi marta yozganda ko‘radigan maslahatlar: «Katalog», «Buyurtmalarim», «Qanday to‘lash», «Sotuvchi bilan bog‘lanish». Bosish do‘konning tegishli qismini yoki savolni tasvirlash so‘rovini ochadi. Matnlarni 80 belgigacha o‘zgartirish mumkin; qatordagi belgi maslahatni yoqadi.

Sarlavhadagi «yoqilgan» kaliti (standart holatda o‘chirilgan). Maslahatlar faqat Instagram avtojavobi va «Directdagi do‘kon» moduli yoqilganda chiqadi; «Katalog» va «Qanday to‘lash» — do‘konning o‘sha qismlari yoqilganda. Instagram maslahatlarni darhol qabul qilmasa, karta bu haqda aytadi, platforma esa o‘zi qayta urinib ko‘radi.

## Avtojavob · WhatsApp {#dbot-whatsapp}

Instagram’dagi kabi sozlamalar: kalit, «Nimaga javob berish», buyruqlar, tushunarsiz xabarga javob, javobingizdan keyingi pauza va «Yozishmada nima mavjud» (tezkor xaridsiz). Qo‘shimcha ravishda faqat WhatsApp uchun ikkita sozlama.

## Istisno ro‘yxati va WhatsApp shabloni {#dbot-wa-extra}

«Istisno ro‘yxatidagi raqamlarga javob bermaslik («Xabarlar» bo‘limi)» yoqilgan — bot shu ro‘yxatdagi raqamlar (masalan, xodimlaringiz yoki ulgurji xaridorlar) bilan jim turadi, ularga o‘zingiz javob berasiz.

«24 soatlik oynadan tashqari xabarlar uchun shablon» — WhatsApp xaridorga faqat uning xabaridan keyin bir sutka ichida erkin matn bilan yozishga ruxsat beradi. Buyurtma haqidagi bildirishnomalar keyinroq ham yetib borishi uchun Meta tasdiqlagan bitta parametrli shablonni va ikki nuqta orqali tilni ko‘rsating, masalan order_update:ru. Shablonsiz bot oddiy xabar yuborishga harakat qiladi, WhatsApp esa uni o‘tkazmasligi mumkin.

Meta katalogidan savat: bot bunday buyurtmani o‘zi rasmiylashtirishi uchun Meta katalogida artikul sifatida mahsulot id’sini, uning raqamini yoki admin paneldagi aniq nomini ko‘rsating.
