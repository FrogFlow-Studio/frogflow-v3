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

- «Faqat buyurtmalar bo‘yicha» (standart) — bot faqat unga murojaat qilinganda javob beradi: «start», «katalog» yoki sizning chaqiruv so‘zingiz, material kodi (masalan #245 yoki kartadagi kalit so‘zlardan biri), tugmalar, buyurtmaga chek — va xaridor u bilan yozishayotgan paytda. Oddiy xabarlarga jim turadi: dialog o‘qilmagan holda qoladi, siz esa ilovada kimga javob berish kerakligini ko‘rasiz. Istisno — «Savolsiz xabarlar va boshqa davlatlardan to‘lov» kartasidagi SI javoblari (boshqa davlatdan to‘lov, «bir nechta material bitta chek bilan mumkinmi?», botda yo‘q material): bot ularga ham javob bermasligi uchun u yerda «Oddiy xabarlarga javob bermaslik»ni yoqing.
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

## AI maslahatchi javobidagi «Sotib olish» tugmasi {#dbot-buy-button}

Standart holatda yoqilgan. Xaridor aniq mahsulot haqida so‘raganda yoki variantni (masalan, sinfni) aytganda, AI maslahatchi qisqa tavsif va narx bilan javob beradi va ostiga «🛒 Sotib olish» tugmasini qo‘yadi. Bosilganda shu mahsulotga buyurtma darhol rasmiylashtiriladi va to‘lov yuboriladi, «Buyurtma beramizmi?» degan savolsiz. Mahsulotning variantlari bo‘lsa va xaridor hali tanlamagan bo‘lsa, tugma bo‘lmaydi: maslahatchi avval variantni aniqlaydi. Maslahatchi, «savat» va «buyurtma rasmiylashtirish» yoqilganda ishlaydi. O‘chirilgan bo‘lsa, maslahatchi avvalgidek xarid haqida so‘z bilan so‘raydi.

## Instagram’dagi tezkor savollar {#ice-breakers}

Xaridor Direct’da sizga birinchi marta yozganda ko‘radigan maslahatlar: «Katalog», «Buyurtmalarim», «Qanday to‘lash», «Sotuvchi bilan bog‘lanish». Bosish do‘konning tegishli qismini yoki savolni tasvirlash so‘rovini ochadi. Matnlarni 80 belgigacha o‘zgartirish mumkin; qatordagi belgi maslahatni yoqadi.

Sarlavhadagi «yoqilgan» kaliti (standart holatda o‘chirilgan). Maslahatlar faqat Instagram avtojavobi va «Directdagi do‘kon» moduli yoqilganda chiqadi; «Katalog» va «Qanday to‘lash» — do‘konning o‘sha qismlari yoqilganda. Instagram maslahatlarni darhol qabul qilmasa, karta bu haqda aytadi, platforma esa o‘zi qayta urinib ko‘radi.

## Avtojavob · WhatsApp {#dbot-whatsapp}

Instagram’dagi kabi sozlamalar: kalit, «Nimaga javob berish», buyruqlar, tushunarsiz xabarga javob, javobingizdan keyingi pauza va «Yozishmada nima mavjud» (tezkor xaridsiz). Qo‘shimcha ravishda faqat WhatsApp uchun ikkita sozlama.

## Istisno ro‘yxati va WhatsApp shabloni {#dbot-wa-extra}

«Istisno ro‘yxatidagi raqamlarga javob bermaslik («Xabarlar» bo‘limi)» yoqilgan — bot shu ro‘yxatdagi raqamlar (masalan, xodimlaringiz yoki ulgurji xaridorlar) bilan jim turadi, ularga o‘zingiz javob berasiz.

«24 soatlik oynadan tashqari xabarlar uchun shablon» — WhatsApp xaridorga faqat uning xabaridan keyin bir sutka ichida erkin matn bilan yozishga ruxsat beradi. Buyurtma haqidagi bildirishnomalar keyinroq ham yetib borishi uchun Meta tasdiqlagan bitta parametrli shablonni va ikki nuqta orqali tilni ko‘rsating, masalan order_update:ru. Shablonsiz bot oddiy xabar yuborishga harakat qiladi, WhatsApp esa uni o‘tkazmasligi mumkin.

Meta katalogidan savat: bot bunday buyurtmani o‘zi rasmiylashtirishi uchun Meta katalogida artikul sifatida mahsulot id’sini, uning raqamini yoki admin paneldagi aniq nomini ko‘rsating.

## Savolsiz xabarlar va boshqa davlatlardan to‘lov {#direct-triage}

«To‘lov va sozlamalar» bo‘limidagi karta, agar Instagram yoki WhatsApp va yozishmadagi do‘kon ulangan bo‘lsa. Qanday xabar kelganini so‘zlar ro‘yxati emas, SI tushunadi; xabar har doim «Chat»da qoladi. SI xarajati — bir xabarga sentning ulushi, do‘konga kuniga 0,3 $ dan oshmaydi.

## Oddiy xabarlarga javob bermaslik {#direct-keep-unread}

«Oddiy xabarlarga javob bermaslik» — standart holatda o‘chiq. Botning har qanday javobi Instagram’dagi dialogni o‘qilgan deb belgilaydi va siz uni yangilar orasida ko‘rmay qolasiz. Buyurtmaga aloqasi yo‘q hamma xabarlarga o‘zingiz javob bermoqchi bo‘lsangiz, yoqing. Shunda bot boshqa davlatdan to‘lov haqidagi savollarga, «qanday olsam bo‘ladi?», «bir nechta material bitta chek bilan mumkinmi?» savollariga va botda yo‘q material nomiga javob bermaydi, «Barcha xabarlarga» rejimida esa «Savolingizni sotuvchiga yetkazdim» deb ham yozmaydi. Bunday xabar sizga murojaat bo‘lib keladi, «Chat»da qoladi va Instagram’da o‘qilmagan holda turadi. Tugmalar, material kodlari, buyurtma berish, to‘lov va chekni bot avvalgidek yuritadi. Yoqilgan paytda quyidagi «Javob berish…» kalitlari ishlamaydi.

## Savolsiz xabarlar {#direct-chatter}

«„Rahmat“, emoji va „+“ uchun murojaat ochmaslik» — sukut bo‘yicha yoqilgan. Direct yoki WhatsApp’ga savol ham, iltimos ham bo‘lmagan xabar kelsa («Rahmat! 🌹», «Barakalla!», «🔥», «+», «Obuna bo‘ldim»), bot jim turadi va murojaat ochmaydi. Xabar nimaligini so‘zlar ro‘yxati emas, SI xabar va yozishma bo‘yicha hal qiladi. Xabar baribir «Chat»da ko‘rinadi. Buyurtma topshirilgandan keyingi «rahmat»ga bot avvalgidek «„Rahmat“ga javob» matni bilan bir marta javob beradi (Sozlamalar → Bot matni → Instagram). «Rahmat, qachon keladi?» — bu savol: u sizga murojaat bo‘lib keladi. O‘chirilgan — har bir bunday xabar avvalgidek murojaat ochadi.

## Boshqa davlatlardan to‘lov {#direct-foreign-pay}

«Boshqa davlatlardan to‘lov haqida javob berish» — sukut bo‘yicha yoqilgan. Xaridor o‘z davlatidan yoki o‘z valyutasida to‘lash mumkinmi deb so‘raydi («Belarus rublida bo‘ladimi?», «O‘zbekistondanman, qanday to‘layman?», «so‘mda qancha?»), sizda esa bu davlat uchun to‘lov usuli yo‘q. Bot sutkada bir marta javob beradi: «Davlatingizdan to‘lovni hozir ulayapmiz. Savolingiz sotuvchiga yuborildi — u shu yerda qanday to‘lashni yozadi», savol esa sizga murojaat bo‘lib keladi, rekvizitlarni o‘zingiz yuborasiz. Matn «Sozlamalar → Bot matni → Instagram → Boshqa davlatdan to‘lov» bo‘limida o‘zgartiriladi. Davlat uchun to‘lov usuli qo‘shilgan bo‘lsa, bot xaridorni odatiy yo‘l bilan olib boradi. Rossiya bunga kirmaydi: unga RF kartasi bilan to‘lov yoki sizning rekvizitlaringiz ishlaydi. O‘chirilgan — bot bunday savollarga javob bermaydi, ular sizga murojaat bo‘lib keladi.

Agar shunday xaridor baribir Kaspi o‘tkazmasini tanlab, «Bo‘lmaydi» deb yozsa, bot bir buyurtmaga bir marta javob beradi: «Kaspi faqat Qozog‘iston kartalarini qabul qiladi. Davlatingizdan (Qirg‘iziston) to‘lovni hozir ulayapmiz: sotuvchi shu yerda qanday to‘lashni yozadi» — bankni so‘ramaydi. Davlatni bot xaridor avval yozganidan oladi («Men Qirg‘izistondanman»). Savol sizga murojaat bo‘lib keladi. Matn — «Sozlamalar → Bot matni → Instagram → Boshqa davlatdan Kaspi».

Agar shunday xaridor «to‘lovni ulayapmiz» javobini olgan bo‘lsa va keyin «Купить» tugmasini bossa, bot buyurtmani rasmiylashtiradi, lekin Kaspi o‘tkazmasi va «RF kartasi bilan» to‘lovni ko‘rsatmaydi — ularning hech biri unga to‘g‘ri kelmaydi. Bot: «№…-buyurtma rasmiylashtirildi. Davlatingizdan (Qirg‘iziston) to‘lovni hozir ulayapmiz: sotuvchi shu yerda qanday to‘lashni yozadi» deb yozadi, sizga esa buyurtma raqami bilan murojaat va xabarnoma keladi. Buyurtma to‘lovni kutadi: rekvizitlarni o‘zingiz yuborsangiz, bot chekni odatdagidek qabul qiladi. Qayta «Купить» bosilsa — o‘sha javob, rekvizitlarsiz. «Boshqa davlatlardan to‘lov haqida javob berish» yoqilgan va o‘sha davlat uchun to‘lov usuli yo‘q paytda ishlaydi. Matn — «Sozlamalar → Bot matni → Instagram → To‘lovsiz davlatdan buyurtma».

## «Купить» tugmasidan keyin «qanday olaman?» {#direct-how-to-buy}

«Купить» tugmasidan keyin «qanday olaman?» savoliga javob berish» — sukut bo‘yicha yoqilgan. Xaridor «Купить» tugmali qoida xabarini oldi va «Qanday olsa bo‘ladi?», «qanday buyurtma beraman?» deb yozadi, buyurtma esa hali yo‘q. Bu xarid haqidagi savol ekanini so‘zlar ro‘yxati emas, AI tushunadi. Bot «Materialni olish uchun xabar ostidagi «Купить» tugmasini bosing: buyurtmani rasmiylashtirib, to‘lov usullarini yuboraman» deb javob beradi va tugmani qayta yuboradi — 30 daqiqada bir martadan ko‘p emas; shu yarim soat ichidagi takroriy savol sizga keladi. Buyurtma to‘lovni kutayotgan bo‘lsa yoki xaridorga o‘zingiz yozayotgan bo‘lsangiz, bot bunday javob bermaydi. Matn — «Sozlamalar → Bot matni → Instagram → Materialni qanday olish mumkin». O‘chirilgan — bunday savollar avvalgidek sizga keladi.

## Bir nechta material bitta chek bilan {#direct-several-items}

«“Bir nechta material bitta chek bilan bo‘ladimi?” savoliga javob berish» — sukut bo‘yicha yoqilgan. Xaridor bir nechta materialni bitta buyurtma yoki bitta chek bilan sotib olish yoki to‘lash mumkinmi, deb so‘raydi («Shu 2 ta materialni bitta chek bilan olsa bo‘ladimi?»). Bu qanday savol ekanini SI tushunadi. Bot sutkada bir marta: «Savolingiz sotuvchida: bir nechta materialni bitta chek bilan to‘lash mumkinligini shu yerda yozadi» deb javob beradi, savol esa sizga murojaat bo‘lib keladi. Buyurtma bo‘lsa, u avvalgidek to‘lovni kutadi. Matn — «Sozlamalar → Bot matni → Instagram → Bir nechta material bitta chek bilan». O‘chirilgan bo‘lsa — bot jim turadi, savol sizga avvalgidek keladi.

## Botda yo‘q material {#direct-product-request}

«Botda yo‘q material nomiga javob berish» — sukut bo‘yicha yoqilgan. Xaridor material nomini yozadi («Классный уголок», «Материал для доски»), bunday nomli qoida yoki mahsulot esa yo‘q. Bu material so‘rovi ekanini SI tushunadi. Bot sutkada bir marta: «Savolingiz sotuvchida: sizga shu yerda yozishadi. Hozircha katalogdagi materiallarni ko‘rishingiz mumkin» deb, «Katalog» tugmasi bilan javob beradi. Savol sizga murojaat bo‘lib keladi; xaridor nomni takrorlasa, takrorlar yangi javobsiz o‘sha murojaatga yoziladi. Direct’da katalog o‘chirilgan bo‘lsa, bot javob bermaydi. Bot materialni nomi bo‘yicha o‘zi yuborishi uchun shu nomli mahsulot va qoida qo‘shing. Matn — «Sozlamalar → Bot matni → Instagram → Botda yo‘q material».
