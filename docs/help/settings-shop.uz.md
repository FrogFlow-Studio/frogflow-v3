# Sozlamalar: do‘kon

keywords: sozlamalar, do‘kon, nomi, valyuta, vaqt mintaqasi, vitrina, sayt, rang, ballar, sodiqlik, oferta, do‘kon haqida, bezash, maydoncha, suv belgisi, haftalik hisobot, avtomatik xabarlar, instagram xabarlari, nastroyki
group: guide
order: 400
pages: /admin/settings

«To‘lov va sozlamalar» sahifasi do‘konning barcha sozlamalarini jamlaydi. Chap tomonda — mavzular, yuqorida — sozlama nomi bo‘yicha qidiruv; har bir kartaning burchagida «?» bor, u uning tavsifini ochadi. Bu maqola «Do‘kon» mavzusi haqida: nomi, vitrina, huquqiy sahifalar, hisobotlar va xizmat xabarlari. Qayerdan topish mumkin: «Menyu → Sozlamalar → To‘lov va sozlamalar» (qandolatchilik va gul do‘konlarida — «To‘lov va yetkazib berish», sotuvsiz maslahatchida — shunchaki «Sozlamalar»).

Sahifani egasi va administratorlar ko‘radi. Deyarli hammasini ular o‘zgartira oladi; to‘lovlar, jamoa, API kaliti, ma’lumotlarni yuklab olish va do‘konni o‘chirishni faqat egasi o‘zgartiradi. Karta yaqinda o‘zgartirilgan bo‘lsa, u «Yaqinda o‘zgartirilgan» belgisi bilan yuqoriga ko‘tariladi.

## Do‘kon {#shop}

Asosiy karta: do‘kon qanday nomlanadi va u bilan qanday bog‘lanish mumkin. Barcha maydonlar kartaning pastidagi bitta «Saqlash» tugmasi bilan saqlanadi.

## Nomi va Telegram ID {#shop-name}

«Botdagi nomi» — Telegram-botda, vitrinada va havola prevyusida do‘kon nomi. Bo‘sh bo‘lsa — do‘kon platformada ro‘yxatdan o‘tgan nom olinadi.

«Buyurtma bildirishnomalari uchun Telegram ID» — bot yangi buyurtmalar va cheklarning «qabul qilish» va «rad etish» tugmalari bor kartalarini hamda boshqa bildirishnomalarni kimga yuboradi. Vergul bilan bir nechta ID va guruh ID’sini ko‘rsatish mumkin. Egasi bildirishnomalarni doim oladi. Odam o‘z ID’sini botingizdagi /id buyrug‘i bilan bilib oladi. Bot odamga yoza olishi uchun u botda kamida bir marta «Start» tugmasini bosishi kerak. Bildirishnomalar yetib borishini «Bildirishnomalar» bo‘limidagi («Botlar» mavzusi) «Bildirishnomalarni tekshirish» tugmasi bilan tekshirish mumkin.

## Valyuta va vaqt mintaqasi {#shop-currency}

«Do‘kon valyutasi» — yangi mahsulotlar, rekvizitlar va vitrina uchun standart valyuta; buyurtmaning eng kam summasi, bepul yetkazib berish chegarasi va qadoq narxi ham shu valyutada beriladi.

«Vaqt mintaqasi» — topshirish sanalari, dam olish kunlari, bildirishnomalarning sokin soatlari, botning ish vaqti, eslatmalar va yuklab olishlar shu bo‘yicha hisoblanadi. Bo‘sh bo‘lsa — «platformadagidek (Olmaota)».

## Vitrina: sarlavha, rang, saytda rasmiylashtirish {#shop-storefront}

«Vitrina sarlavhasi» — saytda do‘kon nomi ostidagi bitta qator. Bo‘sh bo‘lsa — «Sotuvchi haqida»dan olinadi.

«Vitrina rangi» — belgi va rang tanlash. Belgi qo‘yilgan — vitrina tugmalari va urg‘ulari bezash mavzusi ustidan sizning rangingizda bo‘ladi. Belgi olingan — platforma rangi.

«Saytda buyurtma rasmiylashtirish» («Ochiq veb-vitrina» moduli bo‘lganda). Yoqilgan — xaridor raqamli mahsulotlarni to‘g‘ridan-to‘g‘ri vitrinada o‘z davlati rekvizitlari bo‘yicha to‘laydi, chek yuklaydi, materiallar esa buyurtma sahifasida ochiladi. O‘chirilgan — saytda buyurtma rasmiylashtirilmaydi.

«Vitrinada xaridorlarning Telegram orqali kirishi» — saytdagi «Telegram orqali kirish» tugmasi; shunda saytdan va botdan kelgan buyurtmalar bitta xaridor kartasida jamlanadi. Yoqishdan oldin @BotFather’ga /setdomain yuboring, do‘kon botini tanlang va vitrina manzilini ko‘rsating. Busiz tugma «Bot domain invalid» xatosini ko‘rsatadi: platforma buni siz uchun tekshira olmaydi. Saytda rasmiylashtirish bilan birga ishlaydi.

## «Sotuvchi bilan bog‘lanish» havolasi {#shop-contact}

Masalan, Telegram’ingizga havola, uni bot «Bog‘lanish» tugmasi bo‘yicha ko‘rsatadi. Bo‘sh bo‘lsa — bot aloqa ko‘rsatilmaganini aytadi. Prays bo‘yicha maslahatchida havola «savolingizni menejerga beraman» javobiga qo‘shiladi.

## Xarid uchun ballar {#shop-loyalty}

Maydonlar «Sodiqlik dasturi» moduli bo‘lganda ko‘rinadi.

«Xarid uchun ballar, buyurtma summasining %» — buyurtmaning necha foizi ballar bilan qaytariladi. Ballar buyurtma topshirilgandan keyin hisoblanadi; keyingi buyurtmani to‘lashda 1 ball = valyutaning 1 birligi. Standart qiymat — 5.

«Ballar bilan ko‘pi bilan, buyurtma summasining %» — ballar bilan to‘lash chegarasi. 100 — butun buyurtmani ballar bilan to‘lash mumkin. Qolganini xaridor odatdagidek to‘laydi.

## Materiallar tili {#shop-lang}

Maydon «Ko‘p tillilik» moduli bo‘lganda ko‘rinadi.

- «Topshirishda so‘rash» — Telegram’da bot topshirishda har bir pozitsiya uchun tilni tugma bilan so‘raydi; Instagram va WhatsApp’da xaridor barcha tillarni oladi.
- «Rasmiylashtirishdan oldin so‘rash (barcha tillar narxi bilan)» — xaridor tilni savatdayoq tanlaydi va «barcha tillar»ni olishi mumkin: shunda pozitsiya mahsulotning tillari qancha bo‘lsa, shuncha barobar qimmat turadi.

## Ko‘rsatma va topshirish xabariga qo‘shimcha {#shop-texts}

«Xaridor uchun ko‘rsatma matni» — botning Telegram’dagi «Yo‘riqnoma» tugmasiga javobi. Bo‘sh bo‘lsa — yo‘nalishingizning standart matni.

«Topshirish xabariga qo‘shimcha (Instagram, WhatsApp)» — Direct va WhatsApp’dagi «buyurtma yetkazildi» xabarining oxirgi xatboshisi, masalan «Fayllarni yuklab olishga ulgurmagan bo‘lsangiz, qayta yuborish pullik». Bo‘sh bo‘lsa — «Xat kelmagan bo‘lsa, „Spam“ papkasini tekshiring va shu yerga yozing, yordam beramiz.» Maydon Instagram yoki WhatsApp ulangan bo‘lsa ko‘rinadi.

## Huquqiy sahifalar {#legal}

«Yuridik sahifalar» moduli bo‘lganda bor. To‘rtta matn: «Ommaviy oferta», «Maxfiylik siyosati», «Sotuvchi rekvizitlari», «Sotuvchi haqida». Ular botda «Ma’lumot» tugmasi bo‘yicha va vitrinada ko‘rsatiladi. Matn bo‘sh bo‘lsa — sahifa yashiriladi.

Oferta va siyosatdagi «Onlayn maktab uchun shablonni qo‘yish (RF)» tugmasi maydonga shablonni qo‘yadi (u yerda matn bo‘lsa, avval so‘raydi). Shablon — boshlang‘ich nuqta: kvadrat qavslardagi ma’lumotlarni to‘ldiring va matnni yuristga ko‘rsating. Shablon faqat «Saqlash» tugmasi bilan saqlanadi.

Oferta yoki siyosat e’lon qilinganda, saytdagi xaridor rozilik belgisini qo‘yadi, botda esa to‘lov paytida aksept haqidagi qatorni ko‘radi.

## Do‘kon haqida (vitrinadagi sahifa) {#about}

Vitrinadagi «Do‘kon haqida» sahifasi uchun so‘zlaringiz: «Do‘kon tavsifi», «Telefon», «Manzil», «Ish vaqti», «Yetkazib berish», «To‘lov». U yerda xaridorlar yangi tasdiqlangan sharhlarni ham ko‘radi. Hech narsa to‘ldirilmaguncha, sahifa bo‘lmaydi. Qidiruv tizimlari do‘kon haqidagi ma’lumotni shu maydonlardan oladi.

«Vitrinam xaridor ko‘zi bilan» tugmasi vitrinangizni yangi varaqda xaridorlar ko‘rgandek ochadi.

## Vitrinani bezash {#design}

O‘zgarishlar «Saqlash»dan keyin xaridorlarga darhol ko‘rinadi.

- «Mavzu» — «Yangi», «Iliq» yoki «Klassika». «Do‘kon» kartasidagi o‘z «Vitrina rangi» mavzu ustida qoladi.
- «Do‘kon muqovasi» — katalog ustidagi katta rasm: sotuvdagi birinchi mahsulot surati. Surat bo‘lmasa, muqova ko‘rsatilmaydi.
- «Katalogdagi surat shakli»: «Kvadrat» — surat kvadratni to‘ldiradi, tik suratlarning chetlari kesiladi; «Tik 4:5» — karta balandroq, 4:5 surat to‘liq ko‘rinadi; «To‘liq» — har qanday surat kvadrat ichida to‘liq ko‘rinadi, bo‘sh joy — fon.
- «Bosh sahifa bloklari» — «Yangiliklar», «Xitlar», «To‘plamlar», «Sharhlar». Belgilanganlari katalog ustida tanlangan tartibda turadi (↑ va ↓ strelkalari). Bo‘sh blokni xaridor ko‘rmaydi. «Xitlar» — tasdiqlangan sharhlari bor mahsulotlar.

## FrogFlow maydonchasi {#marketplace}

FrogFlow do‘konlarining umumiy katalogi, unda xaridorlar do‘konlarni o‘zlari topadi. Maydonchada faqat nomi, toifasi, shahri va vitrinaga havola ko‘rinadi; buyurtmalar, summalar va xaridorlar u yerga tushmaydi.

«FrogFlow maydonchasida ko‘rsatish» — sizning roziligingiz. Shundan keyin do‘kon operator tasdig‘ini kutadi; holat forma ostida yozilgan («operator tasdig‘i kutilmoqda», «maydonchada ko‘rsatiladi», «operator yashirdi»). Standart holatda o‘chirilgan. «Maydonchadagi toifa» — bo‘sh bo‘lsa, do‘kon yo‘nalishi. Pastda — maydonchadan vitrinangizga o‘tishlar hisoblagichi.

## Mualliflar hamjamiyati {#community}

[Hamjamiyat](/admin/community) uchun profil — platforma mualliflari tajriba almashadigan joy.

«Meni hamjamiyatda ko‘rsatish» — o‘chirilgan bo‘lsa, sizni boshqa mualliflar ko‘rmaydi, o‘zingiz ham hamjamiyatda o‘qiy va yoza olmaysiz. Yoqing, «Nomi», «Yo‘nalish», «Shahar», «Nima bilan shug‘ullanaman», «Havolalar»ni to‘ldiring va «Saqlash»ni bosing. Do‘kon ma’lumotlari (buyurtmalar, summalar, xaridorlar) hamjamiyatga tushmaydi.

«Do‘konlarni tavsiya qilish» — o‘zingiz tavsiya qiladigan bir nechta do‘konni belgilang. Tavsiya vitrinalarda va mualliflar sahifalarida faqat o‘zaro bo‘lganda ko‘rinadi: o‘sha do‘kon ham sizni belgilaganda. Belgini olib tashlasangiz — ikkalasida ham yo‘qoladi.

## PDF’ni qayta sotishdan himoya {#watermark}

Kalit topshiriladigan PDF’larga suv belgisini yoqadi: har bir sahifada kim sotib olgani (lotincha ismi, @login yoki pochta) va buyurtma raqami yoziladi. Katalogdagi asl nusxa o‘zgarmaydi. O‘chirilgan — PDF belgisiz ketadi. Standart holatda o‘chirilgan. Darhol saqlanadi.

## Sovg‘a qadog‘i {#gift-wrap}

«To‘plamlar va sovg‘alar» moduli bo‘lganda, faqat jismoniy buyurtmalar uchun bor.

- «Buyurtmani sovg‘a sifatida rasmiylashtirishni taklif qilish» — xaridor Telegram’da va saytda «Bu sovg‘a» tugmasini ko‘radi; Instagram va WhatsApp’da bot bu haqda rasmiylashtirishdan oldin so‘raydi. O‘chirilgan — sovg‘a belgilari yo‘q.
- «Sovg‘a qadog‘ini taklif qilish» — sovg‘ani belgilagan xaridor qadoq qo‘sha oladi.
- «Qadoq narxi» — buyurtma summasida, chekda va jurnalda alohida qator; promokod unga chegirma bermaydi.

## Katalog bo‘yicha aqlli qidiruv {#smart-search}

«Katalog bo‘yicha aqlli qidiruv» moduli bo‘lganda bor. Botdagi yoki vitrinadagi oddiy qidiruv hech narsa topmasa, «besh yoshli bolaga tug‘ilgan kun uchun nimadir» kabi so‘rov SI yordamida ma’nosi bo‘yicha tanlanadi.

Kalit qidiruvni yoqadi (standart holatda o‘chirilgan). Har bir chaqiruv pullik va [SI balansidan](/admin/ai-balance) yechiladi; chegara — bitta bot uchun kuniga 200 ta chaqiruv va bitta xaridorda 45 soniyada bir martadan ko‘p emas. Pastda — bugungi va jami chaqiruvlar hamda xarajat. Platformada SI kaliti berilmagan bo‘lsa, kalit mavjud emas.

## Haftalik hisobot {#weekly}

Har dushanba 9:00 da bot sizga o‘tgan hafta natijalarini admin panel tilida yuboradi. Kalit standart holatda yoqilgan; o‘chirsangiz — hisobot kelmaydi.

Pastdagi belgilar tushum va buyurtmalarga nima qo‘shishni tanlaydi: «To‘lov va topshirish tezligi», «Yangi va qaytgan xaridorlar», «Voronka va eng yaxshi kanal», «Top mahsulotlar». Darhol saqlanadi. Do‘konda sotuv bo‘lmaguncha, hisobot yuborilmaydi.

## Yangi avtomatik xabarlar {#auto-v3}

Kalit xaridorlarga uchta avtomatik xabarni yoqadi: topshirilgandan bir necha kun keyin baho so‘rash, «aksiya ertaga tugaydi» eslatmasi va Instagram hamda WhatsApp’da savat haqida eslatma. Soatiga bir marta u kutish ro‘yxatidagi va xabar darhol bormagan odamlarga «Mahsulot paydo bo‘ldi» xabarini ham yuboradi.

Xabarlar faqat do‘kon yoza oladigan odamlarga va sutkasiga bitta marketing xabaridan ko‘p bo‘lmagan holda yuboriladi. Har biri qo‘shimcha ravishda o‘z moduliga bog‘liq. O‘chirilgan (standart) — xaridorlarga bularning hech biri yuborilmaydi.

## Instagram va WhatsApp xizmat xabarlari {#service-notices}

Bot sizga Telegram’da Instagram va WhatsApp’dagi yozishmalar haqida yuboradigan xabarlar. O‘chirish xaridorlar uchun hech narsani o‘zgartirmaydi. Buyurtmalar, cheklar va shikoyatlar bu yerga kirmaydi — ular «Bildirishnomalar» bo‘limida.

- «Xaridor rasm yubordi, lekin to‘lov kutayotgan buyurtma yo‘q» — standart holatda yoqilgan.
- «Suhbatda bot pauzada: siz xaridorga o‘zingiz javob berdingiz» — standart holatda yoqilgan.
- «Xaridor yozishmada telefon raqamini yubordi» — standart holatda yoqilgan.
- «Bot raqamga «Raqamingizni yozib oldim» deb javob beradi» — bu bildirishnoma emas, xaridorga javob. Standart holatda o‘chirilgan: botning javobi yozishmani o‘qilgan qiladi va raqamni o‘tkazib yuborish oson.
