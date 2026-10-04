/**
 * Центр уведомлений (seed/shop19-a-notify.ts, shop19-a-notify.spec.ts): отдельный магазин
 * «Уведомления А19» — два заказа с событиями и отзыв, плюс бухгалтер. Основной магазин сида не меняется.
 */
export const NTF19_SHOP_ID = "e2e19040-0000-4000-8000-000000000001";
export const NTF19_SHOP_NAME = "Уведомления А19";
export const NTF19_SHOP_SLUG = "e2e-ntf19";
export const NTF19_SELLER_LOGIN = "e2e_ntf19_seller";
export const NTF19_SELLER_PASSWORD = "e2e-ntf19-pass-123";
export const NTF19_ACC_LOGIN = "e2e_ntf19_acc";
export const NTF19_ACC_PASSWORD = "e2e-ntf19-acc-123";
export const NTF19_BUYER = "Данияр Н";
// Отметка «прочитано» хранится по логину, а база общая для desktop и phone: у каждого проекта свой менеджер.
export const NTF19_STAFF_PASSWORD = "e2e-ntf19-staff-123";
export const ntf19StaffLogin = (project: string) => `e2e_ntf19_${project}`;
