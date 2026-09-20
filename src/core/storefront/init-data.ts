import { createHmac, timingSafeEqual } from "node:crypto";

/** Проверка initData Telegram Mini App подписью токена бота. */
export type WebAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type InitDataResult =
  | { ok: true; user: WebAppUser; authDate: number }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "no_user" };

export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 3600,
  now = Math.floor(Date.now() / 1000),
): InitDataResult {
  const trimmed = initData.trim();
  if (!trimmed) return { ok: false, reason: "missing" };
  const params = new URLSearchParams(trimmed);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "invalid" };
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) if (k !== "hash") pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };
  const authDate = Number(params.get("auth_date"));
  if (!authDate || !Number.isFinite(authDate)) return { ok: false, reason: "invalid" };
  if (now - authDate > maxAgeSec) return { ok: false, reason: "expired" };
  try {
    const user = JSON.parse(params.get("user") ?? "") as WebAppUser;
    if (typeof user.id !== "number") return { ok: false, reason: "no_user" };
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, reason: "no_user" };
  }
}

/** Собрать initData для тестов — той же подписью, что проверяется. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}
