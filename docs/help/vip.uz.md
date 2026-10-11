# VIP obunalar: pullik yopiq guruh

keywords: vip, obuna, pullik guruh, yopiq kanal, yopiq chat, klub, obuna orqali kirish, uzaytirish, tarif, guruhdan chiqarish, podpiska
group: guide
order: 250
pages: /admin/vip

Yopiq Telegram-guruhga pullik kirish: tariflar, cheklarni qabul qilish, muddat tugashi haqida eslatmalar va muddat tugaganda chiqarish. Alohida VIP-bot orqali ishlaydi. Qayerda topish mumkin: «Menyu → Marketing → VIP obunalar» (VIP moduli ulangan bo‘lsa).

Har qanday xodim ko‘ra oladi, to‘lovlarni tasdiqlash va tariflarni o‘zgartirish — menejer va undan yuqorilar. «VIP sozlamalari» kartochkasini faqat do‘kon admini yoki egasi saqlaydi.

## VIP-bot {#bot}

1. @BotFather’da alohida bot yarating va uning tokenini «VIP-bot tokeni» maydoniga qo‘ying.
2. Bu botni yopiq guruhga a’zolarni taklif qilish va chiqarish huquqi bilan admin qilib qo‘shing.
3. Guruh ID-sini «VIP sozlamalari»da ko‘rsating.

«Ulash» tokenni tekshiradi va botni ulaydi. «Almashtirish» — botni almashtirgan bo‘lsangiz. «VIP-botni uzish» uni do‘kondan ajratadi: obunachilar undan javob va eslatmalar olmay qo‘yadi.

## VIP sozlamalari {#settings}

- «VIP-guruh ID-si» — -1001234567890 ko‘rinishidagi manfiy son.
- «Birinchi eslatma» va «Ikkinchi eslatma» — obuna tugashiga necha kun qolganda bot uzaytirishni eslatadi. Ikkinchisi birinchisidan albatta kam bo‘lsin.
- «Faollashtirishdagi xabar» — obuna kuchga kirganda a’zo nima oladi.
- «To‘lov rekvizitlari» — xaridor ularni tarifni tanlagandan keyin ko‘radi va chekni shu chatga yuboradi.
- «Muddatlarni hozir tekshirish» — kerakli eslatmalarni darhol yuborish va muddati tugaganlarni chiqarish (odatda bu avtomatik bo‘ladi).

## Test rejimi {#test-mode}

«Test rejimi: muddatlar kun o‘rniga daqiqada» almashtirgichi.

Yoqilgan — obunalar va eslatmalar muddati daqiqada hisoblanadi (tarifdan «Test rejimidagi muddat, daqiqa» olinadi). Shunday qilib yarim soatda butun yo‘lni tekshirish mumkin: to‘lov, guruhga havola, eslatma, chiqarish.

O‘chirilgan — oddiy ish, muddatlar kunda. Ishga tushirishdan oldin test rejimini o‘chirishni unutmang.

## Chekni avtotekshirish {#auto-confirm}

«Chekni avtotekshirish: mos kelsa — obuna o‘zi uzaytiriladi» almashtirgichi.

Yoqilgan — chek tarif narxi bilan buyurtmalardagidek solishtiriladi: o‘sha valyutada kam to‘lov qabul qilinmaydi. Chek mos kelsa, obuna sizsiz yoqiladi yoki uzaytiriladi. Shubhali chek sizga tugmalar bilan keladi. «Cheklarni avtotekshirish» moduli va oylik tekshiruvlarning bo‘sh limiti kerak, aks holda almashtirgich ostida ogohlantirish chiqadi.

O‘chirilgan — har bir chekni «Obunachilar» ro‘yxatida o‘zingiz tasdiqlaysiz.

## Tariflar {#tariffs}

«+ Tarif»: «Nomi», «Tavsif», «Narxi», «Valyuta», «Muddati, kun», «Test rejimidagi muddat, daqiqa» va «Tartib» (xaridordagi ro‘yxatdagi o‘rni). Har bir tarifning o‘z havolasi bor — uni xaridorga yuborish mumkin.

## Faol, Ochiq, Birinchi kirish {#tariff-flags}

- «Faol»: yoqilgan — tarifni sotib olish mumkin; o‘chirilgan — tarif taklif qilinmaydi.
- «Ochiq»: yoqilgan — tarif VIP-botda hammaga ko‘rinadi va u bo‘yicha obuna uzaytiriladi; o‘chirilgan — tarif yashirin: faqat shaxsiy havola orqali mavjud va a’zoga biriktiriladi.
- «Birinchi kirish»: yoqilgan — tarif yangi a’zolarga bir marta ko‘rsatiladi (masalan, chegirmali sinov oyi); uzaytirish esa ochiq tariflar bo‘yicha bo‘ladi.

## Obunachilar {#subscribers}

Holat bo‘yicha filtr («To‘lov kutilmoqda», «Faollar», «Muddati tugaganlar», «Rad etilganlar») va ism, @username, ID yoki tarif bo‘yicha qidiruv.

- «Ochish» — chekni ko‘rish.
- «Tasdiqlash» — to‘lov to‘g‘ri, obuna kuchga kiradi, a’zo guruhga havola oladi.
- «Rad etish» — sababini ko‘rsating, xaridor uni ko‘radi.
- «± kun» — muddatni uzaytirish yoki qisqartirish.
- «Havolani qayta yuborish» — a’zo taklifni yo‘qotgan bo‘lsa.
- «Chiqarish» — guruhdan chiqarib, kirishni yopish.

## A’zoni qo‘lda qo‘shish {#manual}

Botdan tashqarida to‘laganlar uchun: «Telegram ID», «Tarif», «Kun (bo‘sh — tarif bo‘yicha)» va «Holat»: «Faol — havola yuborish» (a’zo darhol havola oladi) yoki «Muddati tugagan — faqat tarix» (kirishsiz oddiy yozuv). «Qo‘shish» tugmasini bosing.
