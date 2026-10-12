# Sozlamalar: to‘lov va yetkazib berish

keywords: yetkazib berish, olib ketish, zaklad, oldindan to‘lov, slotlar, dam olish kunlari, yetkazish hududlari, bepul yetkazish, eng kam summa, to‘lov eslatmasi, robokassa, kaspi, apipay, prodamus, sbp, stripe, kripto, yulduzlar, stars, cheklarni tanish, dostavka
group: guide
order: 410

[To‘lov va sozlamalar](/admin/settings) sahifasidagi «To‘lov va yetkazib berish» mavzusi: xaridor jismoniy buyurtmani qanday oladi, qancha to‘laydi va qaysi onlayn to‘lov usullari ulangan. Kassa kartalarini (Robokassa, Kaspi, Stripe, Prodamus, kriptovalyuta, Telegram Stars) faqat egasi ko‘radi va o‘zgartiradi; qolganini — egasi va administratorlar.

## Jismoniy mahsulotlar: olish va to‘lov {#fulfillment}

Faqat jismoniy buyurtmalarga (tortlar, gullar, yetkazib beriladigan mahsulotlar) taalluqli. Raqamli mahsulotlarga aloqasi yo‘q. Barcha maydonlar bitta «Saqlash» tugmasi bilan saqlanadi.

## Olib ketish va yetkazib berish {#ful-pickup}

«Olib ketish» va «Yetkazib berish» belgilari — xaridor tanlay oladigan olish usullari. Ikkalasi ham standart holatda yoqilgan. Keraksizining belgisini oling — xaridor uni tanlay olmaydi.

## Jismoniy buyurtmalarni to‘lash {#ful-payment}

- «Chek bo‘yicha to‘liq oldindan to‘lov» — xaridor butun buyurtmani to‘laydi va chek yuboradi.
- «Chek bo‘yicha zaklad, qolgani olishda» — avval xaridor zaklad to‘laydi («Zaklad, summaning %» maydoni, standart 30), qolganini — olishda.
- «Olishda to‘lash, cheksiz» — buyurtma to‘lovsiz rasmiylashtiriladi, xaridor olishda to‘laydi.

## Slotlar, dam olish kunlari va chegaralar {#ful-calendar}

«Olish vaqti slotlari» — har qatorga bittadan, masalan «10:00–12:00». Xaridor sanadan keyin vaqtni tanlaydi. Bo‘sh bo‘lsa — faqat sana.

«Dam olish kunlari» va «Dam olish sanalari» (har qatorga bittadan: «31.12.2026» yoki oraliq «30.12.2026–03.01.2027»). Bu kunlarda xaridor olishni tanlay olmaydi, tayyorlash muddati esa faqat ish kunlari bo‘yicha hisoblanadi. Haftaning barcha yetti kunini belgilab bo‘lmaydi. O‘tgan sanalar o‘zi o‘chiriladi.

«Kuniga buyurtmalar soni» va «Slotga buyurtmalar soni» — chegaralar. Bo‘sh bo‘lsa — cheklovsiz. Topshirish sanasi bor buyurtmalar hisoblanadi, rad etilgan, bekor qilingan va qaytarilganlaridan tashqari. Xaridorning cheksiz to‘lanmagan buyurtmasi joyni bir sutka band qiladi. Band sana yoki slot xaridorga taklif qilinmaydi. O‘zingiz kiritgan buyurtmalar cheklanmaydi. Slot chegarasi faqat slotlar berilganda ishlaydi.

## Yetkazish hududlari {#zones}

Yetkazish narxi bor tumanlar. Xaridor hududni tanlaydi, uning narxi buyurtmaga qo‘shiladi. Hududlar bo‘lmasa, bot shunchaki manzilni so‘raydi.

«+ Hudud» — «Nomi» (masalan «Almalin tumani»), «Narxi», «Tartib», «Faol» belgisi. Belgini olib tashlash hududni xaridorlardan yashiradi.

## Bepul yetkazib berish {#free-delivery}

«Umumiy chegara» — savatdagi mahsulotlar chegirmalar va ballardan keyin kamida shu summa tursa, yetkazib berish bepul, xaridor esa savatda yana qancha qo‘shish kerakligini ko‘radi. 0 — bepul yetkazishsiz. Har bir faol hudud uchun o‘z chegarasini berish mumkin; bo‘sh bo‘lsa — umumiy chegara. Sovg‘a sertifikati chegaraga ta’sir qilmaydi: bu chegirma emas, to‘lov.

## Buyurtmaning eng kam summasi {#min-order}

Bot, sayt va Instagram/WhatsApp’dagi do‘kon bundan kam summaga buyurtma berishga ruxsat bermaydi va qancha qo‘shish kerakligini aytadi. Chegirmalargacha bo‘lgan savat summasi hisoblanadi. 0 — eng kam summasiz. Bepul mahsulotlarni eng kam summa bloklamaydi.

## To‘lov eslatmasi {#pay-remind}

Botdan, Instagram yoki WhatsApp’dan kelgan buyurtma to‘lanmasa, bot tanlangan vaqtdan keyin xaridorga summa va rekvizitlarni bir marta eslatadi: rasmiylashtirilgandan 1, 2, 3, 6 yoki 12 soat keyin. «Eslatmaslik» — o‘chirilgan. Instagram va WhatsApp’da eslatma faqat xaridor so‘nggi sutkada do‘konga yozgan bo‘lsa yuboriladi: aks holda Instagram va WhatsApp birinchi bo‘lib yozishga ruxsat bermaydi. Darhol saqlanadi.

## Shubhali buyurtmalar bo‘yicha eslatmaslik {#pay-remind-hold}

Yoqilgan (standart) — xaridorda ochiq murojaat bo‘lsa (boshqa mahsulot haqida so‘ragan yoki chekni sizga to‘g‘ridan-to‘g‘ri, masalan WhatsApp’da yuborgan) yoki bu buyurtmadan keyin boshqasini rasmiylashtirgan bo‘lsa, eslatma yuborilmaydi. Uning o‘rniga sizga buyurtma havolasi bilan «№… buyurtma: to‘lov eslatmasi yuborilmadi» xabari keladi, buyurtma tarixida ham shu belgi chiqadi: buyurtmani bekor qiling yoki to‘lovni tasdiqlang. Buyurtmadan 3 kundan ko‘proq oldin ochilgan va yangi xabarsiz murojaat hisobga olinmaydi. O‘chirilgan — bot avvalgidek eslatadi.

## To‘lovdan keyin pochta (Instagram) {#email-ask}

Materiallar har doim yozishmaga keladi. «Chekdan keyin pochtani so‘rash» yoqilgan — chekdan keyin bot pochtani so‘raydi va u yerga nusxasini yuboradi. O‘chirilgan — so‘ramaydi; xaridor pochtaga yuborishni o‘zi so‘rasa, bot manzilni so‘rab, xat yuboradi.

## Pochta ixtiyoriy {#email-optional}

Yoqilgan (standart) — pochta haqidagi savolga xaridor «vatsap», «shu yerga», «instagramga», «kerak emas» deb javob bersa, bot bir marta: «Fayllar chek tekshirilgach shu yerga, yozishmaga keladi. Pochta — ixtiyoriy» deb yozadi va pochtani boshqa so‘ramaydi. Manzilni baribir yozsa, u saqlanadi. Xatoli manzilga o‘xshash matnni («anna mail.ru») bot to‘liq yozishni so‘raydi. O‘chirilgan — bunday javoblar sizga savol sifatida keladi.

## Chek matn bilan {#receipt-text}

Kaspi ba’zan skrinshot qilishga ruxsat bermaydi va xaridor ilovadan chek matnini qo‘yadi: «Оплата совершена 800 ₸ … № чека QR…». Yoqilgan (standart) — matnda operatsiya raqami yoki chek so‘zlari («оплата совершена», «перевод выполнен», «получатель») bilan birga valyutali summa bo‘lsa, bot uni chek deb hisoblaydi. Xaridorga — «Chekni qabul qildim, tekshiruvga yuboraman», sizga — chek matni va «Подтвердить и выдать» tugmasi bilan buyurtma xabari. Boshqa buyurtma bo‘yicha o‘sha operatsiya raqami qabul qilinmaydi. Avtotekshiruv matnni o‘qimaydi: pul tushganini o‘zingiz tekshiring. «800 tg to‘ladim» — chek emas: bot skrinshot so‘raydi. O‘chirilgan — to‘lov bosqichidagi matn sizga savol sifatida keladi.

## Yozishmadagi to‘lov va cheklar {#pay-chat}

Instagram va WhatsApp uchun kartochka. Xaridor nima yozganini so‘zlar ro‘yxati emas, SI tushunadi; xabar har doim «Chat»da qoladi. SI xarajati — bir xabarga sentning ulushi, «Savolsiz xabarlar» bilan bir xil kunlik chegarada (do‘konga kuniga 0,3 $). To‘rtala almashtirgich ham sukut bo‘yicha yoqilgan. Javob matnlari «Sozlamalar → Bot matni → Instagram» bo‘limida o‘zgartiriladi.

## To‘lov o‘tmadi {#pay-failed}

«Xaridor to‘lov o‘tmaganini yozsa, chekni qabul qilmaslik». Xaridor «O‘tmayapti» yozuvli rasm yoki rasm va ketidan «O‘tmayapti», «xato», «rad etildi» deb yuboradi. Bu chek emas, xato skrinshoti: bot «To‘lov o‘tmaganga o‘xshaydi. Qayta to‘lab ko‘ring yoki qaysi bankdan foydalanishingizni yozing» deb javob beradi, buyurtma «to‘lovni kutmoqda» holatida qoladi, savol sizga keladi. Agar chek yozilib ulgurgan bo‘lsa (rasm 15 daqiqadan oldin kelmagan bo‘lsa), u olib tashlanadi: buyurtma yana to‘lovni kutadi, buyurtma tarixida — «Chek olib tashlandi», sizga — «pul tushmaguncha tasdiqlamang» xabari. Keyinroq yuborilgan rasm — yangi urinish, u chek sifatida qabul qilinadi. O‘chirilgan — rasm avvalgidek chek sifatida qabul qilinadi.

## Skrinshot yuborilmayapti {#receipt-text-offer}

«Skrinshot yuborilmasa, chekni matn bilan taklif qilish». Xaridor «skrinshot yuklanmayapti», «chekni bu yerga yubora olmayapman», «WhatsApp’ga mumkinmi?» deb yozadi. Bot bir buyurtmaga bir marta «Skrinshotsiz ham bo‘ladi: bank ilovasidagi chekning to‘liq matnini operatsiya raqami va summasi bilan shu yerga nusxalab yuboring» deb javob beradi va bunday matnni chek sifatida qabul qiladi («Chek matn bilan» bo‘limiga qarang). Xaridor bu haqda yana yozsa, xabar sizga keladi. Faqat «Chekni matn bilan qabul qilish» yoqilganda ishlaydi. O‘chirilgan — bot avvalgidek skrinshotni qanday biriktirishni tushuntiradi.

## Buyurtmadan keyin darhol mahsulot raqami {#unpaid-number}

«Buyurtmadan keyin darhol mahsulot raqami — avval buyurtma haqida». Hali to‘lanmagan buyurtmadan keyingi dastlabki 30 daqiqada xaridor bitta raqam yoki son («3») yozadi. Ko‘pincha bu yangi mahsulot emas, oldingi savolga javob: bot 003 mahsulotni ochmaydi, «#N buyurtma to‘lovni kutmoqda — qanday to‘lash yuqoridagi xabarda. Buyurtmani bekor qilish uchun «Отмена» deb yozing. Boshqa mahsulot kerak bo‘lsa — uning raqamini yana bir bor yuboring» deb javob beradi. Bir buyurtmaga bir marta: qayta yuborilgan raqam mahsulotni ochadi. O‘chirilgan — raqam darhol mahsulotni ochadi.

## Eski buyurtmani qayta yuborish {#resend-old}

«14 kundan eski buyurtmani qayta yuborishdan oldin so‘rash». Xaridor pochta yubordi yoki materiallarni so‘raydi, to‘lovdan keyingi SI xatni qayta yubormoqchi, lekin xaridorning oxirgi buyurtmasiga 14 kundan oshgan. Ehtimol, u sizdan to‘g‘ridan-to‘g‘ri sotib olgan boshqa materialni kutmoqda. Bot «Oxirgi buyurtmangiz — №N, 10.09 (…). Uni pochtaga qayta yuboraymi? «Ha» deb javob bering. Boshqa material kutayotgan bo‘lsangiz, qaysi ekanini yozing» deb so‘raydi va xatni faqat «ha» deganidan keyin (30 daqiqa ichida) yuboradi. Boshqa javob sizga keladi. O‘chirilgan — xat darhol ketadi.

## Telegram Stars {#stars}

«Telegram Stars orqali to‘lov» moduli bo‘lganda bor. Telegram-botda xaridor yulduzlar bilan bir bosishda, kartasiz va rekvizitsiz to‘laydi. Yulduzlar bot balansiga tushadi; ularni Fragment orqali yechib olish mumkin.

«1 ⭐ narxi» — do‘kon valyutasidagi kurs. Buyurtma summasi kursga bo‘linadi va yuqoriga yaxlitlanadi. Bo‘sh bo‘lsa — yulduzlar bilan to‘lash tugmasi yo‘q. Kurs o‘zi yangilanmaydi.

## Robokassa: karta orqali to‘lov {#robokassa}

Robokassa kassangiz orqali karta bilan to‘lov: Telegram-botda, Instagram/WhatsApp’da va saytda. Kassa to‘lov haqida xabar berganda buyurtma o‘zi tasdiqlanadi.

1. Robokassa shaxsiy kabinetida kartadagi Result URL, Success URL va Fail URL manzillarini, POST usulini, MD5 algoritmini ko‘rsating.
2. «Kassa mamlakati»ni tanlang: «Qozog‘iston (robokassa.kz, tenge)» yoki «Rossiya (robokassa.ru, rubl)».
3. MerchantLogin, «Parol #1 (ishchi)» va «Parol #2 (ishchi)»ni qo‘ying.
4. «Karta orqali to‘lovni yoqish»ni belgilang va «Saqlash»ni bosing.

Kassa o‘z valyutasida yechadi: karta bilan to‘lash tugmasi faqat tengedagi (Qozog‘iston kassasi) yoki rubldagi (Rossiya kassasi) buyurtmalarda chiqadi.

«Test rejimi» — to‘lovlar Robokassa test parollari orqali o‘tadi, haqiqiy pul yechilmaydi. Ishdan oldin o‘chirishni unutmang.

Rossiya kassasi uchun: «54-FZ chekini yuborish (Robokassa onlayn-kassasi)», «Soliq tizimi» («Shaxsiy kabinetdagidek» yoki o‘zingizniki) va «QQS». Chekka pozitsiyalar va yetkazib berish kiradi; chegirma pozitsiyalarga taqsimlanadi, chek summasi to‘lov summasiga teng.

## Cheklarni tanish {#receipt-ocr}

«Chekni aniqlash» moduli bo‘lganda bor. Botga yuborilgan chekni SI o‘qiydi: summa, valyuta, sana, operatsiya raqami, qabul qiluvchi. Bot uni buyurtma, to‘lov usuli rekvizitlari va oldingi cheklar bilan solishtiradi va xabarnomada hamda buyurtma kartasida yozadi: «mos keldi», sabablari bilan «shubhali» (tahrir izlari, to‘lov «ishlov berilmoqda», chek buyurtmadan oldin) yoki «takror» (o‘sha fayl yoki operatsiya raqami avval bo‘lgan). To‘lovsiz yoki to‘lov xatosi bor skrinshotni bot qayta yuborishni so‘raydi. Chekni bank tasdiqlamaydi: pul tushganini o‘z bankingizda tekshiring.

«Cheklarni avtotekshirish» yoqilgan — shunday ishlaydi. O‘chirilgan — barcha cheklar sizga tekshiruvsiz keladi.

«Chek mos kelsa, buyurtmani darhol berish» sukut bo‘yicha o‘chirilgan: buyurtmani siz tugma bilan tasdiqlaysiz. Yoqsangiz — mos chek fayllarni xaridorga o‘zi beradi, shubhali chek va takror baribir sizga keladi.

Cheklovlar haqida rostini aytsak: platformada tanish kaliti hali berilmagan bo‘lsa, karta bu haqda yozadi, kalit mavjud emas va operator uni qo‘shmaguncha barcha cheklar qo‘lda tekshirishga ketadi. Tarifingizning oylik chegarasidan oshganda va [SI balansi](/admin/ai-balance) tugaganda ham cheklarni o‘zingiz tekshirasiz. Kartaning pastida — shu oyda va jami nechta chek tanilgani.

## Kriptovalyuta: NOWPayments {#crypto}

«Kripto orqali to‘lov (NOWPayments)» moduli bo‘lganda bor. Telegram-botda xaridor kriptovalyutadagi hisobni oladi; tarmoq tasdiqlagandan keyin buyurtma o‘zi tasdiqlanadi.

1. NOWPayments kabinetida kartadagi IPN manzilini ko‘rsating.
2. «API kaliti» va «IPN siri»ni qo‘ying.
3. «Kriptovalyutada to‘lov qabul qilish»ni belgilang va «Saqlash»ni bosing.

## Xorijiy karta: Stripe {#stripe}

«Chet eldan karta orqali to‘lov (Stripe, PayPal)» moduli bo‘lganda bor. Boshqa davlatlardagi xaridorlar Telegram-botda va saytda karta yoki PayPal orqali to‘laydi; buyurtma o‘zi tasdiqlanadi.

1. Stripe kabinetida (Developers → Webhooks) kartadagi manzilni checkout.session.completed va checkout.session.async_payment_succeeded hodisalari bilan qo‘shing.
2. Karta maydonlariga Stripe kabinetidagi maxfiy kalitni (sk_ bilan boshlanadi) va bildirishnomalar imzosi sirini (whsec_ bilan boshlanadi) qo‘ying.
3. «Xorijiy karta va PayPal orqali to‘lov qabul qilish»ni belgilang va «Saqlash»ni bosing.

## RF kartasi va SBP: Prodamus {#prodamus}

«Prodamus orqali to‘lov (Rossiya)» moduli bo‘lganda bor. O‘z Prodamus akkaunti bor sotuvchi uchun: to‘lov formasi Rossiya kartalari va SBP’ni qabul qiladi. To‘lov tugmasi Telegram-botda, Instagram/WhatsApp’da va saytda bor; buyurtma o‘zi tasdiqlanadi.

1. Prodamus kabinetidan to‘lov formasi manzili va maxfiy kalitni nusxalang, to‘lov bildirishnomalari manzili sifatida esa kartadagisini ko‘rsating.
2. «To‘lov formasi manzili» va «Maxfiy kalit»ni to‘ldiring.
3. «Kassa valyutasi»ni va kerak bo‘lsa «Kurs»ni tanlang.
4. «Rossiya kartasi va SBP orqali to‘lov qabul qilish»ni belgilang va «Saqlash»ni bosing.

Summa qanday hisoblanadi. Kassa valyutasidagi buyurtma o‘z holicha to‘lanadi. Narxlar tengeda, kassa esa rublda bo‘lsa, kursni ko‘rsating — 1 rubl necha tenge: tengedagi summa unga bo‘linadi va butun rublgacha yuqoriga yaxlitlanadi, xaridor summani rublda ko‘radi. Kurs bo‘lmasa, tengedagi buyurtmalarda Prodamus tugmasi yo‘q. Kurs o‘zi yangilanmaydi — uni shu yerda o‘zgartiring.

.kz manzilli forma faqat tengeda hisoblaydi. Unda kurs berilgan bo‘lsa, rubldagi buyurtma sizning kursingiz bo‘yicha tengeda chiqariladi (tengegacha yuqoriga), xaridorning banki esa kartadan rublni Prodamus kursi bo‘yicha yechadi. Shuning uchun birja kursini emas, Prodamus kursini qo‘ying, aks holda kartadan rubl narxidan ko‘proq yechiladi.

## Kaspi: ApiPay {#kaspi}

«Kaspi Pay orqali to‘lov» moduli bo‘lganda bor. Telegram-botda, Instagram va WhatsApp’da «Kaspi orqali to‘lash» tugmasi: xaridor Kaspi ilovasida to‘laydi, pul sizning Kaspi Pay’ingizga tushadi, buyurtma o‘zi tasdiqlanadi va topshiriladi.

ApiPay’da kassir ulangan tashkilotingiz bo‘lishi kerak.

1. ApiPay kabinetida (Sozlamalar → API kalitlari) kartadagi manzilni ko‘rsating.
2. Karta maydonlariga ApiPay kabinetidagi API kalitini va bildirishnomalar imzosi sirini qo‘ying.
3. «Kaspi orqali to‘lov qabul qilish»ni belgilang va «Saqlash»ni bosing.

«Test rejimi» — ApiPay qumdoni: havolalar haqiqiy emas, test to‘lovlari haqiqiy to‘lov sifatida hisobga olinadi. Xaridorlar bilan ishlashdan oldin uni o‘chiring.
