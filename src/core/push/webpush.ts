import { previewReadonly } from "@/lib/preview";
import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from "node:crypto";

/**
 * Web Push без сторонних пакетов: шифрование тела по RFC 8291 (aes128gcm,
 * ECDH P-256 + HKDF) и подпись VAPID по RFC 8292 (JWT ES256). Ключи VAPID
 * платформы — в окружении (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, base64url).
 */
export type PushSubscription = { endpoint: string; p256dh: string; auth: string };
export type Vapid = { publicKey: string; privateKey: string; subject: string };

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");
const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** Службы push браузеров: сервер ходит только к ним (защита от SSRF). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([\w-]+\.)*push\.apple\.com$/,
  /^([\w-]+\.)*notify\.windows\.com$/,
];

export function validPushEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/**
 * Тело по RFC 8291: заголовок (соль, размер записи, открытый ключ
 * отправителя) и одна запись AES-128-GCM с разделителем 0x02.
 */
export function encryptPayload(
  sub: Pick<PushSubscription, "p256dh" | "auth">,
  payload: Buffer,
  opts: { salt?: Buffer; ecdh?: ReturnType<typeof createECDH> } = {},
): Buffer {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  const ecdh = opts.ecdh ?? createECDH("prime256v1");
  if (!opts.ecdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ?? randomBytes(16);
  // HKDF(auth, ecdh) → IKM; HKDF(salt, IKM) → ключ и nonce содержимого.
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Заголовок Authorization VAPID: JWT ES256 на адрес службы push, 12 часов. */
export function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): string {
  const pub = fromB64u(vapid.publicKey);
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: vapid.subject,
      }),
    ),
  );
  const sig = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

export type PushResult = "sent" | "gone" | "failed";

export async function sendWebPush(
  sub: PushSubscription,
  payload: unknown,
  vapid: Vapid,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  if (!validPushEndpoint(sub.endpoint)) return "gone";
  // Предпросмотр: не отправляем и не снимаем подписку.
  if (previewReadonly()) return "failed";
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers: {
        authorization: vapidAuthorization(sub.endpoint, vapid),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: "86400",
        urgency: "high",
      },
      body: new Uint8Array(encryptPayload(sub, Buffer.from(JSON.stringify(payload)))),
      signal: AbortSignal.timeout(10_000),
    });
    // 404/410 — подписка снята в браузере: удалить, больше не слать.
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
