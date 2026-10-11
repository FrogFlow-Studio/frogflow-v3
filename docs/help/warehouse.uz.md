# Ombor: kirim, hisobdan chiqarish, inventarizatsiya

keywords: ombor, qoldiqlar, kirim, tushum, hisobdan chiqarish, nuqson, inventarizatsiya, qayta sanash, yetkazib beruvchilar, yetkazib beruvchiga buyurtma, ombor jurnali, sotilmay yotgan tovar, tannarx, sklad

group: guide

order: 130

pages: /admin/warehouse

Jismoniy mahsulotlar qoldig‘i harakatini hisobga olish: yetkazib beruvchilar, kirimlar, hisobdan chiqarishlar, inventarizatsiya, buyurtmalar va jurnal. Qayerdan topish mumkin: «Menyu → Katalog → Ombor». Ombor moduli ulangan bo‘lsa, bo‘lim bor. Buxgalter faqat «Ombor jurnali» ni ko‘radi. Qoldiqning har bir o‘zgarishi mahsulot tarixida qoladi.

## Yetkazib beruvchilar {#suppliers}

Kim nima olib keladi: yetkazib beruvchilar kontaktlari. «Yetkazib beruvchi qoʻshish», «Saqlash». Mahsulotning asosiy yetkazib beruvchisi mahsulotning o‘z kartasida tanlanadi. O‘chirilganda yetkazib beruvchi uning barcha mahsulotlaridan olib tashlanadi.

## Kirim {#receipts}

Yetkazib beruvchidan kelgan mahsulot.

1. «Yangi kirim» ni bosing, mahsulotlar, «Miqdor» va narxni qo‘shing.
2. «Qoralamani saqlash» — keyinroq qaytish mumkin, qoldiq hozircha o‘zgarmaydi.
3. «Oʻtkazish» — mahsulotlar qoldig‘i ko‘payadi.

O‘tkazilgan kirimni o‘zgartirib bo‘lmaydi — xatoni hisobdan chiqarish yoki inventarizatsiya bilan tuzating. «Qoralamani oʻchirish» o‘tkazilmagan kirimni o‘chiradi. Qoldig‘i hisobga olinmaydigan mahsulotlar qatorlari o‘tkazib yuboriladi.

## Tannarxni o‘rtacha tortilgan usulda yangilash {#update-cost}

Kirimdagi belgi. Yoqilgan — o‘tkazishda mahsulot tannarxi qayta hisoblanadi: (qoldiq × avvalgi + kirim × narx) ÷ (qoldiq + kirim). Variantning o‘z tannarxi bor. O‘chirilgan — tannarx o‘zgarmaydi.

## Hisobdan chiqarish {#writeoffs}

Nuqson, yo‘qotish, «o‘zimga», boshqa. Mahsulot, «Miqdor» va «Sabab» («Nuqson», «Yoʻqotish», «Oʻzimga», «Boshqa») ni tanlang, «Hisobdan chiqarish» ni bosing va tasdiqlang. Qoldiq kamayadi, zarar tannarx bo‘yicha hisoblanadi. Hisobdan chiqarishni bekor qilib bo‘lmaydi.

## Inventarizatsiya {#stocktake}

Mahsulotlar bo‘yicha haqiqiy qoldiqni kiriting va «Tasdiqlash» ni bosing. Tasdiqlash qoldiqni raqam bilan almashtirmaydi, unga «sanalgan minus hisobdagi» farqini qo‘shadi: sanash paytida kelgan buyurtmalar yo‘qolmaydi. Tasdiqlashni bekor qilib bo‘lmaydi.

## Ombor jurnali {#journal}

Qoldiqning barcha o‘zgarishlari: kirimlar, hisobdan chiqarishlar, inventarizatsiyalar, buyurtmalar va tuzatishlar. «Sabab» filtri, «Koʻrsatish», «CSV yuklab olish». Kirimlar, hisobdan chiqarishlar va inventarizatsiyalar doimiy saqlanadi, boshqa harakatlar — 180 kun.

## Yetkazib beruvchilarga buyurtmalar {#requests}

Nima buyurtma qilish kerak: tugab borayotgan mahsulotlar va prognoz, yetkazib beruvchilar bo‘yicha. «Buyurtma, dona» ni ko‘rsating va «Buyurtma yaratish» ni bosing. «Matnni nusxalash» yoki «CSV yuklab olish» — va yetkazib beruvchiga o‘zingiz yuboring: tizim buyurtmalarni yubormaydi. Buyurtmadan kirim qoralamasini yaratib, haqiqiy miqdorni tuzatish mumkin.

## Sotilmay yotgan tovar {#stale}

Tanlangan kunlar davomida sotilmagan, qoldig‘i bor mahsulotlar va ularda qancha pul muzlab qolgani (tannarx bo‘yicha). Bu muddatdan yosh yangi mahsulotlar ko‘rsatilmaydi. «Aksiya yaratish» tanlangan mahsulotlarga chegirmani ishga tushiradi.
