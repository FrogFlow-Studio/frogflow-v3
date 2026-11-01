import { decryptSecret, encryptSecret, isEncryptedSecret } from "./vault";

/**
 * Ключи платёжных систем продавца в app_settings. До 01.11.2026 они лежали
 * открытым текстом (пароли Robokassa у Копилки и AATeach, ключ Prodamus у
 * Копилки), хотя токены каналов давно шифруются. Теперь запись шифрует их
 * (core/settings: setSetting), чтение расшифровывает, а старое открытое
 * значение при первом чтении перезаписывается зашифрованным.
 */
export const SECRET_SETTING_KEYS: ReadonlySet<string> = new Set([
  "robokassa_pass1",
  "robokassa_pass2",
  "robokassa_pass1_test",
  "robokassa_pass2_test",
  "prodamus_secret_key",
  "nowpayments_api_key",
  "nowpayments_ipn_secret",
  "stripe_secret_key",
  "stripe_webhook_secret",
  "kaspi_apipay_api_key",
  "kaspi_apipay_webhook_secret",
]);

export function isSecretSetting(key: string): boolean {
  return SECRET_SETTING_KEYS.has(key);
}

/** Значение для записи в базу: секрет шифруется, пустое и уже зашифрованное — как есть. */
export function sealSetting(key: string, value: string, secretsKey: () => string): string {
  if (!isSecretSetting(key) || value === "" || isEncryptedSecret(value)) return value;
  return encryptSecret(value, secretsKey());
}

/** Значение из базы для кода: зашифрованное расшифровывается, остальное — как есть. */
export function openSetting(key: string, stored: string, secretsKey: () => string): string {
  if (!isSecretSetting(key) || !isEncryptedSecret(stored)) return stored;
  return decryptSecret(stored, secretsKey());
}

/** Секрет ещё лежит открытым текстом и его пора зашифровать. */
export function needsSealing(key: string, stored: string | null | undefined): stored is string {
  return isSecretSetting(key) && !!stored && !isEncryptedSecret(stored);
}
