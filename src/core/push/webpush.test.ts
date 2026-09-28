import { createDecipheriv, createECDH, createHmac, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encryptPayload, sendWebPush, validPushEndpoint, vapidAuthorization } from "./webpush";

const hmac = (k: Buffer, d: Buffer) => createHmac("sha256", k).update(d).digest();

/** Браузер: ключи подписки и расшифровка тела по RFC 8291 — сверка с шифрованием сервера. */
function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.from("0123456789abcdef");
  const sub = {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: auth.toString("base64url"),
  };
  const decrypt = (msg: Buffer) => {
    const salt = msg.subarray(0, 16);
    const idlen = msg[20]!;
    const asPublic = msg.subarray(21, 21 + idlen);
    const body = msg.subarray(21 + idlen);
    const shared = ecdh.computeSecret(asPublic);
    const prkKey = hmac(auth, shared);
    const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]);
    const ikm = hmac(prkKey, Buffer.concat([info, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
    const d = createDecipheriv("aes-128-gcm", cek, nonce);
    d.setAuthTag(body.subarray(body.length - 16));
    const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
    expect(plain[plain.length - 1]).toBe(2);
    return plain.subarray(0, plain.length - 1).toString();
  };
  return { sub, decrypt };
}

function vapidKeys() {
  const k = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const j = k.privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(j.x!, "base64url"),
    Buffer.from(j.y!, "base64url"),
  ]);
  return {
    vapid: { publicKey: pub.toString("base64url"), privateKey: j.d!, subject: "mailto:a@b.kz" },
    publicKey: k.publicKey,
  };
}

describe("Web Push", () => {
  it("тело шифруется так, что браузер его расшифровывает (RFC 8291)", () => {
    const b = browser();
    const msg = encryptPayload(b.sub, Buffer.from('{"title":"Заказ #12"}'));
    expect(msg.readUInt32BE(16)).toBe(4096);
    expect(b.decrypt(msg)).toBe('{"title":"Заказ #12"}');
  });

  it("VAPID: JWT ES256 на адрес службы, подпись проверяется открытым ключом", () => {
    const { vapid, publicKey } = vapidKeys();
    const h = vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      vapid,
      1_700_000_000_000,
    );
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(vapid.publicKey);
    const claims = JSON.parse(Buffer.from(m[2]!, "base64url").toString());
    expect(claims).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_700_000_000 + 12 * 3600,
      sub: "mailto:a@b.kz",
    });
    const ok = verify(
      "sha256",
      Buffer.from(`${m[1]}.${m[2]}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(m[3]!, "base64url"),
    );
    expect(ok).toBe(true);
  });

  it("сервер ходит только к службам push браузеров", () => {
    expect(validPushEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(validPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(validPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(validPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(validPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(validPushEndpoint("https://evil.com/push.apple.com")).toBe(false);
  });

  it("снятая подписка (410) — «gone», сбой службы — «failed»", async () => {
    const { vapid } = vapidKeys();
    const b = browser();
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/x", ...b.sub };
    const gone = vi.fn(async () => new Response(null, { status: 410 }));
    expect(await sendWebPush(sub, { t: 1 }, vapid, gone as never)).toBe("gone");
    const ok = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await sendWebPush(sub, { t: 1 }, vapid, ok as never)).toBe("sent");
    const init = (ok.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["content-encoding"]).toBe("aes128gcm");
    const bad = vi.fn(async () => new Response(null, { status: 500 }));
    expect(await sendWebPush(sub, { t: 1 }, vapid, bad as never)).toBe("failed");
  });
});
