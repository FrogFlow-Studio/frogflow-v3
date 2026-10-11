# Bot matnlari

keywords: bot matnlari, salomlashish, ish vaqtidan tashqari, ish vaqti, buyurtma uchun minnatdorchilik, tushunmadim, o‘z matni, standart matn, ish jadvali, teksty bota
group: guide
order: 510
pages: /admin/bot-texts

Bu yerda botning o‘zi aytadigan so‘zlarini o‘zgartirasiz: salomlashish, ish vaqtidan tashqari javob, buyurtma uchun minnatdorchilik va bot xabarni tushunmagandagi javob. Maydon bo‘sh bo‘lsa — bot standart matnni aytadi. Qayerdan topish mumkin: «Menyu → Sozlamalar → Bot matnlari». Egasi va administratorlar ko‘radi va o‘zgartiradi.

## Kanal va til {#channel}

Yuqorida kanalni tanlang: «Telegram», «Instagram» yoki «WhatsApp». Hozircha o‘z matnlaringiz faqat Telegram’da ishlaydi: Instagram va WhatsApp’da bot hozircha standart so‘zlar bilan gapiradi.

Til tanlash «Ko‘p tillilik» moduli bo‘lganda paydo bo‘ladi: shunda matn xaridorning har bir tili uchun alohida beriladi. Biror til uchun maydon bo‘sh bo‘lsa, o‘sha tildagi xaridor standart matnni oladi.

## O‘z matni {#custom}

Har bir xabarda 1000 belgigacha bo‘lgan «O‘z matni» maydoni bor. Bo‘sh maydonda standart matn kulrang ko‘rinadi. Maydon ostida — qaysi almashtirishlarni qo‘yish mumkinligi, masalan {shop}; bot ularni haqiqiy qiymatlar bilan almashtiradi. Mavjud bo‘lmagan almashtirishni yozsangiz, karta ogohlantiradi. «Xaridor shunday ko‘radi» bloki tayyor xabarni ko‘rsatadi.

1. Matnni yozing.
2. Uni «Xaridor shunday ko‘radi» blokida tekshiring.
3. «Saqlash»ni bosing.

«Standartga qaytarish» matningizni o‘chiradi, bot yana standart so‘zlar bilan gapiradi.

## Qaysi xabarlarni o‘zgartirish mumkin {#keys}

- «Salomlashish» — xaridor «Start» tugmasini bosib, tilni tanlaganda. {shop} almashtirishi — do‘kon nomi.
- «Ish vaqtidan tashqari» — xaridor ish vaqtidan tashqari yozganda, 6 soatda bir martadan ko‘p emas. {from} va {to} almashtirishlari — ish vaqtining boshlanishi va tugashi. Ish vaqti berilmagan bo‘lsa, yuborilmaydi.
- «Buyurtma uchun rahmat» — buyurtma rasmiylashtirilgandan keyingi alohida xabar. {order} almashtirishi — buyurtma raqami. O‘z matningiz bo‘lmaguncha, bu xabar yuborilmaydi.
- «Tushunmadim» — xaridor bot tushunmagan narsa yozdi.

## Ish vaqti {#hours}

Vaqt do‘konning vaqt mintaqasi bo‘yicha hisoblanadi (u [To‘lov va sozlamalar](/admin/settings) sahifasidagi «Do‘kon» kartasida beriladi). Shu vaqtdan tashqari bot «Ish vaqtidan tashqari» matnini yuboradi.

1. «Boshlanishi» va «Tugashi»ni tanlang.
2. «Soatlarni saqlash»ni bosing.

«Soatlarni olib tashlash» — ish vaqti berilmagan va «Ish vaqtidan tashqari» xabari yuborilmaydi.

Bot butunlay qanday ko‘rinishini [botni oldindan ko‘rish](/admin/bot-preview) sahifasida ko‘ring.
