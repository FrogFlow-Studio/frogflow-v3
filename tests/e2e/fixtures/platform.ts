/** Платформа сквозного прогона: порты, секреты-заглушки, оператор. */
export const E2E_PORT = 3100;
export const STUB_PORT = 54329;
export const STUB = `http://127.0.0.1:${STUB_PORT}`;

export const SECRETS_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
export const WEBHOOK_SECRET = "e2e-webhook-secret-e2e-webhook-secret-00";

export const OPERATOR_LOGIN = "e2e_operator";
export const OPERATOR_PASSWORD = "e2e-operator-pass-123";
