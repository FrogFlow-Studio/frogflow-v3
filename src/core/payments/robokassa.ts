import { createHash, timingSafeEqual } from "node:crypto";
import { parseReceiptSettings, type Receipt, type ReceiptSettings } from "./receipt";

/**
 * Robokassa: Казахстан (auth.robokassa.kz, тенге) и Россия
 * (auth.robokassa.ru, рубли, чек 54-ФЗ параметром Receipt). Подпись MD5 по
 * документации сервиса.
 */
export function md5Hex(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

export type RobokassaRegion = "kz" | "ru";

/** Магазин Robokassa списывает в своей валюте (OutSum без OutSumCurrency). */
export const ROBOKASSA_CURRENCY: Record<RobokassaRegion, string> = { kz: "KZT", ru: "RUB" };
/** Совместимость: казахстанская касса — тенге. */
export const ROBOKASSA_KZ_CURRENCY = ROBOKASSA_CURRENCY.kz;

const HOST: Record<RobokassaRegion, string> = {
  kz: "https://auth.robokassa.kz",
  ru: "https://auth.robokassa.ru",
};

export function robokassaAccepts(
  currency: string | null | undefined,
  region: RobokassaRegion = "kz",
): boolean {
  return (currency ?? "").toUpperCase() === ROBOKASSA_CURRENCY[region];
}

export type RobokassaConfig = {
  login: string;
  pass1: string;
  pass2: string;
  testMode: boolean;
  region?: RobokassaRegion;
  /** Россия: чек 54-ФЗ (система налогообложения и НДС); null — без чека. */
  receipt?: ReceiptSettings | null;
};

export function buildPaymentUrl(
  cfg: RobokassaConfig,
  p: {
    outSum: number;
    invId: number;
    description: string;
    botId: string;
    /** Чек для России; без него при включённом чеке — одна позиция по описанию. */
    receipt?: Receipt;
  },
): string {
  const outSum = p.outSum.toFixed(2);
  const region = cfg.region ?? "kz";
  // Россия с кассой: Receipt — JSON, закодированный в URL один раз; в подписи
  // стоит после InvId, до пароля. В адресе он кодируется ещё раз
  // (URLSearchParams) — Robokassa раскодирует адрес и сверит ту же строку.
  const receipt =
    region === "ru" && cfg.receipt
      ? encodeURIComponent(
          JSON.stringify(
            p.receipt ?? {
              ...(cfg.receipt.sno ? { sno: cfg.receipt.sno } : {}),
              items: [
                {
                  name: p.description.slice(0, 128),
                  quantity: 1,
                  sum: Number(outSum),
                  payment_method: "full_payment",
                  payment_object: "service",
                  tax: cfg.receipt.tax,
                },
              ],
            },
          ),
        )
      : null;
  // Shp_bot — арендатор в колбэке: один result-URL на платформу, а подпись
  // Robokassa включает пользовательские параметры по алфавиту.
  const signature = md5Hex(
    [
      cfg.login,
      outSum,
      p.invId,
      ...(receipt ? [receipt] : []),
      cfg.pass1,
      `Shp_bot=${p.botId}`,
    ].join(":"),
  );
  const q = new URLSearchParams({
    MerchantLogin: cfg.login,
    OutSum: outSum,
    InvId: String(p.invId),
    Description: p.description.slice(0, 100),
    SignatureValue: signature,
    IsTest: cfg.testMode ? "1" : "0",
    ...(receipt ? { Receipt: receipt } : {}),
    ...(region === "ru" ? { Culture: "ru" } : {}),
    Shp_bot: p.botId,
  });
  return `${HOST[region]}/Merchant/Index.aspx?${q.toString()}`;
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
  const region: RobokassaRegion = s.robokassa_region === "ru" ? "ru" : "kz";
  return {
    ready: true,
    login,
    pass1,
    pass2,
    testMode,
    region,
    receipt: region === "ru" ? parseReceiptSettings(s) : null,
  };
}

export const ROBOKASSA_KEYS = [
  "robokassa_enabled",
  "robokassa_test_mode",
  "robokassa_login",
  "robokassa_pass1",
  "robokassa_pass2",
  "robokassa_pass1_test",
  "robokassa_pass2_test",
  "robokassa_region",
  "robokassa_receipt",
  "robokassa_sno",
  "robokassa_tax",
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
