/**
 * Демо-магазин сквозного прогона: всё, что нужно и серверу-заглушке (seed.ts),
 * и тестам. Значения выдуманные, ни одного настоящего ключа.
 */
export const E2E_PORT = 3100;
export const STUB_PORT = 54329;
export const STUB = `http://127.0.0.1:${STUB_PORT}`;

export const SECRETS_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
export const WEBHOOK_SECRET = "e2e-webhook-secret-e2e-webhook-secret-00";

export const ZERNIO_WEBHOOK_SECRET = "e2e-zernio-secret-e2e-zernio-secret-00";
/** Instagram магазина в Zernio: события этого аккаунта — магазину. */
export const IG_ACCOUNT = "e2e-ig-account";
export const IG_PROFILE = "e2e-zernio-profile";

export const SHOP_ID = "e2e00000-0000-4000-8000-000000000001";
export const SHOP_NAME = "Прописи E2E";
export const SHOP_SLUG = "e2e-propisi";
export const BOT_TOKEN = "700000001:E2E-token";
export const SELLER_TG = 500000001;
export const SELLER_LOGIN = "e2e_seller";
export const SELLER_PASSWORD = "e2e-seller-pass-123";

export const OPERATOR_LOGIN = "e2e_operator";
export const OPERATOR_PASSWORD = "e2e-operator-pass-123";

export const PRODUCT_ID = "e2e00000-0000-4000-8000-0000000000a1";
export const PRODUCT_NAME = "Прописи для первого класса";
export const PRODUCT_PRICE = 1500;
/** Номиналы подарочного сертификата на витрине (gift.spec.ts). */
export const GIFT_AMOUNTS = [5000, 10000];
export const PROMO_CODE = "E2E10";
export const MATERIAL_PATH = `${SHOP_ID}/propisi.pdf`;
/** Второй товар — «С этим берут» к первому (правило продавца). */
export const UPSELL_ID = "e2e00000-0000-4000-8000-0000000000a2";
export const UPSELL_NAME = "Раскраска с буквами";

export const ROBOKASSA = { login: "e2e-shop", pass1: "e2e-pass-1", pass2: "e2e-pass-2" };
