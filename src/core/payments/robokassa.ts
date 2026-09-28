import { createHash, timingSafeEqual } from "node:crypto";

/** Robokassa (auth.robokassa.kz): подпись MD5 по документации сервиса. */
export function md5Hex(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

/** Robokassa.kz принимает и списывает только тенге (OutSum без OutSumCurrency). */
export const ROBOKASSA_CURRENCY = "KZT";

export function robokassaAccepts(currency: string | null | undefined): boolean {
  return (currency ?? "").toUpperCase() === ROBOKASSA_CURRENCY;
}

export type RobokassaConfig = { login: string; pass1: string; pass2: string; testMode: boolean };

export function buildPaymentUrl(
  cfg: RobokassaConfig,
  p: { outSum: number; invId: number; description: string; botId: string },
): string {
  const outSum = p.outSum.toFixed(2);
  // Shp_bot — арендатор в колбэке: один result-URL на платформу, а подпись
  // Robokassa включает пользовательские параметры по алфавиту.
  const signature = md5Hex(`${cfg.login}:${outSum}:${p.invId}:${cfg.pass1}:Shp_bot=${p.botId}`);
  const q = new URLSearchParams({
    MerchantLogin: cfg.login,
    OutSum: outSum,
    InvId: String(p.invId),
    Description: p.description.slice(0, 100),
    SignatureValue: signature,
    IsTest: cfg.testMode ? "1" : "0",
    Shp_bot: p.botId,
  });
  return `https://auth.robokassa.kz/Merchant/Index.aspx?${q.toString()}`;
}

export function verifyResultSignature(p: {
  outSum: string;
  invId: string;
  signature: string;
  pass2: string;
  shp: Array<[string, string]>;
}): boolean {
  let check = `${p.outSum}:${p.invId}:${p.pass2}`;
  const custom = [...p.shp].sort((a, b) => a[0].localeCompare(b[0]));
  if (custom.length) check += `:${custom.map(([k, v]) => `${k}=${v}`).join(":")}`;
  const expected = md5Hex(check).toUpperCase();
  const provided = p.signature.toUpperCase();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/** Настройки из app_settings; тестовые пароли — при robokassa_test_mode. */
export function robokassaConfig(
  s: Record<string, string>,
  moduleOn: boolean,
): (RobokassaConfig & { ready: true }) | { ready: false } {
  const enabled = moduleOn && s.robokassa_enabled === "true";
  const testMode = s.robokassa_test_mode === "true";
  const login = s.robokassa_login?.trim() ?? "";
  const pass1 = (testMode ? s.robokassa_pass1_test : s.robokassa_pass1)?.trim() ?? "";
  const pass2 = (testMode ? s.robokassa_pass2_test : s.robokassa_pass2)?.trim() ?? "";
  if (!enabled || !login || !pass1 || !pass2) return { ready: false };
  return { ready: true, login, pass1, pass2, testMode };
}

export const ROBOKASSA_KEYS = [
  "robokassa_enabled",
  "robokassa_test_mode",
  "robokassa_login",
  "robokassa_pass1",
  "robokassa_pass2",
  "robokassa_pass1_test",
  "robokassa_pass2_test",
] as const;

/**
 * Подпись возврата покупателя на SuccessURL: как у result, но паролем №1.
 * Без неё адрес «успеха» с чужим InvId открыл бы страницу чужого заказа.
 */
export function verifySuccessSignature(p: {
  outSum: string;
  invId: string;
  signature: string;
  pass1: string;
  shp: Array<[string, string]>;
}): boolean {
  return verifyResultSignature({ ...p, pass2: p.pass1 });
}
