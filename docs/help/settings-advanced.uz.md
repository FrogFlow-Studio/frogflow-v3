# Sozlamalar: qo‘shimcha

keywords: crm, amocrm, bitriks, google jadvallar, integratsiya, api, api kaliti, ma’lumotlarni yuklab olish, arxiv, ma’lumotlarimni olish, do‘konni o‘chirish, o‘chirish
group: guide
order: 450

[To‘lov va sozlamalar](/admin/settings) sahifasidagi «Qo‘shimcha» mavzusi: CRM va jadvallaringiz bilan aloqa, dasturchilar uchun API kaliti, barcha ma’lumotlarni yuklab olish va do‘konni o‘chirish.

## CRM va Google Jadvallar {#crm}

«CRM va Jadvallar bilan integratsiya» moduli bo‘lganda bor; egasi va administratorlar o‘zgartiradi. Buyurtma hodisalari sizning manzilingizga ketadi: amoCRM yoki Bitrix24 kiruvchi manzili, Google Apps Script veb-ilovasi, Make, Zapier.

1. Manzil maydoniga CRM yoki jadvalingizdagi manzilni qo‘ying (faqat https). Bo‘sh bo‘lsa — integratsiya o‘chirilgan.
2. «Imzo siri» — ixtiyoriy: shunda har bir hodisa imzolanadi va tizimingiz uning do‘kondan kelganini tekshira oladi. Sir berilganda maydon bo‘sh turadi; almashtirish uchun yangisini kiriting.
3. «Qaysi hodisalarni yuborish» — keraklilarini belgilang: buyurtma yaratildi, chek keldi, buyurtma yetkazildi, yetkazish xatosi, buyurtma rad etildi, holat o‘zgardi, to‘lov olindi, qaytarish, kuryerga topshirildi.
4. «Saqlash»ni, keyin yonidagi tekshirish tugmasini bosing — manzilga sinov hodisasi ketadi, karta esa javobni ko‘rsatadi.

## Yetkazish jurnali va qayta yuborish {#crm-log}

Forma ostida — oxirgi 100 ta yuborish: hodisa, buyurtma, serveringiz javobi va vaqt. Server 10 soniya ichida javob bermasa yoki xato bilan javob bersa, hodisa o‘zi qayta yuborilmaydi, chunki u yetib borgan bo‘lishi mumkin. CRM’ga qarang, u yerda hodisa bo‘lmasa, «Qayta yuborish»ni bosing: u o‘sha hodisa raqami bilan yana ketadi va CRM dublikatni tashlab yuborishi mumkin. Ulanish bo‘lmagan bo‘lsa, platforma o‘zi qayta yuboradi.

## Dasturchilar uchun API {#api}

«Dasturchilar uchun API» moduli bo‘lganda bor; faqat egasi. Kalit hisob tizimingizga do‘kon buyurtmalari, mahsulotlari va xaridorlariga kirish imkonini beradi. Uni parol kabi saqlang: kalit kimda bo‘lsa, u xaridorlar kontaktlari bor buyurtmalarni ko‘radi.

1. «Kalit huquqlari»ni tanlang: «Tovarlarni o‘qish va tahrirlash (qoldiq, narx)» yoki «Faqat o‘qish».
2. «Kalit yaratish»ni bosing va uni darhol nusxalab oling — u boshqa ko‘rsatilmaydi.

«Yangi kalit chiqarish» — oldingisi darhol ishlamay qoladi. «Kalitni bekor qilish» — u bilan integratsiyalar ishlamay qoladi. Kartada kalit oxirgi marta qachon va qayerdan ishlatilgani ko‘rinadi. Real vaqtdagi buyurtma hodisalarini CRM integratsiyasi yuboradi (yuqoridagi bo‘lim).

## Ma’lumotlarimni olish {#takeout}

Faqat egasi. «Arxivga havola olish» ZIP-arxivga havola yaratadi: buyurtmalar va ularning pozitsiyalari, xaridorlar, katalog (Excel uchun jadvallar) va parol hamda tokenlarsiz do‘kon sozlamalari. «Arxivni yuklab olish» — havola orqali. Havola 24 soat amal qiladi.

Arxivda xaridorlaringiz kontaktlari bor va uni havolasi bor har kim yuklab olishi mumkin, shuning uchun uni begonalarga yubormang.

## Do‘konni o‘chirish {#delete}

Faqat egasi.

1. «Do‘konni o‘chirish…»ni bosing.
2. Tasdiqlash uchun do‘kon nomini kiriting.
3. «30 kundan keyin o‘chirish»ni bosing.

Do‘kon darhol pauzaga qo‘yiladi: bot pauza xabari bilan javob beradi, vitrina yopiladi. 30 kun davomida uni bannerdagi «Do‘konni tiklash» tugmasi bilan qaytarish mumkin. Keyin do‘kon arxivga o‘tadi, suratlar, fayllar va cheklar o‘chiriladi. Buyurtmalar hisob uchun saqlanadi.
