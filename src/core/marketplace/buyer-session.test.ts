import { describe, expect, it } from "vitest";
import {
  MARKET_SESSION_SEC,
  identityFromUserKey,
  signMarketSession,
  verifyMarketSession,
} from "./buyer-session";

const ID = "5b1d3c2e-8a44-4d0e-9a31-0c5f1e0a7b11";
const OTHER = "6c2e4d3f-9b55-4e1f-8b42-1d6a2f1b8c22";
const NOW = 1_800_000_000;

describe("cookie площадки", () => {
  it("своя подпись читается, срок 30 дней", () => {
    const v = signMarketSession("secret", ID, NOW);
    expect(verifyMarketSession("secret", v, NOW + 10)).toBe(ID);
    expect(verifyMarketSession("secret", v, NOW + MARKET_SESSION_SEC - 1)).toBe(ID);
    expect(verifyMarketSession("secret", v, NOW + MARKET_SESSION_SEC)).toBeNull();
  });

  it("чужой ключ, подмена id или срока и мусор не проходят", () => {
    const v = signMarketSession("secret", ID, NOW);
    expect(verifyMarketSession("other", v, NOW)).toBeNull();
    expect(verifyMarketSession("secret", v.replace(ID, OTHER), NOW)).toBeNull();
    const [id, exp, mac] = v.split(".");
    expect(verifyMarketSession("secret", `${id}.${Number(exp) + 999}.${mac}`, NOW)).toBeNull();
    for (const bad of ["", "x", `${ID}.1.zz`, null, undefined])
      expect(verifyMarketSession("secret", bad, NOW)).toBeNull();
  });
});

describe("удостоверение по ключу профиля", () => {
  it("Telegram и WhatsApp дают удостоверение, Instagram, сайт и мусор — нет", () => {
    expect(identityFromUserKey("tg_1001", "code")).toEqual({
      channel: "telegram",
      id: "1001",
      via: "code",
    });
    expect(identityFromUserKey("wa_77001234567", "code")).toEqual({
      channel: "whatsapp",
      id: "77001234567",
      via: "code",
    });
    for (const key of ["ig_55", "web_x", "tg_0", "tg_-5", "wa_12", "tg_1 2", ""])
      expect(identityFromUserKey(key, "code")).toBeNull();
  });
});
