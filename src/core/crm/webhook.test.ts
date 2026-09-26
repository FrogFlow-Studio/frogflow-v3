import { describe, expect, it } from "vitest";
import {
  isPrivateAddress,
  parseCrm,
  pinnedLookup,
  postPinned,
  safeWebhookUrl,
  signBody,
} from "./webhook";

describe("вебхук в CRM", () => {
  it("только https и публичный хост", () => {
    expect(safeWebhookUrl("https://script.google.com/macros/s/X/exec")).toBe(true);
    expect(safeWebhookUrl("http://example.com/hook")).toBe(false);
    expect(safeWebhookUrl("https://localhost/hook")).toBe(false);
    expect(safeWebhookUrl("https://127.0.0.1/hook")).toBe(false);
    expect(safeWebhookUrl("https://10.1.2.3/hook")).toBe(false);
    expect(safeWebhookUrl("https://192.168.0.5/hook")).toBe(false);
    expect(safeWebhookUrl("https://172.20.0.1/hook")).toBe(false);
    expect(safeWebhookUrl("https://169.254.169.254/latest")).toBe(false);
    expect(safeWebhookUrl("https://user:pw@example.com/")).toBe(false);
    expect(safeWebhookUrl("not a url")).toBe(false);
  });
  it("настройки: небезопасный адрес — нет интеграции; неизвестные события отбрасываются", () => {
    expect(parseCrm(JSON.stringify({ url: "http://x.kz" }))).toBeNull();
    const c = parseCrm(JSON.stringify({ url: "https://x.kz/h", events: ["placed", "hack"] }));
    expect(c?.events).toEqual(["placed"]);
    expect(parseCrm(JSON.stringify({ url: "https://x.kz/h" }))?.events).toContain("delivered");
  });
  it("подпись HMAC-SHA256 тела", () => {
    expect(signBody("{}", "s")).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signBody("{}", "s")).not.toBe(signBody("{}", "t"));
  });
  it("внутренние адреса в любой записи отклоняются", () => {
    for (const u of [
      "https://2130706433/", // 127.0.0.1 десятичным числом
      "https://0x7f.1/",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:a9fe:a9fe]/", // 169.254.169.254
      "https://[fd00::1]/",
      "https://[fe80::1]/",
      "https://100.64.0.1/",
      "https://0.0.0.0/",
      "https://app.localhost/",
    ])
      expect(safeWebhookUrl(u), u).toBe(false);
    expect(safeWebhookUrl("https://[2a00:1450:4001::200e]/hook")).toBe(true);
    expect(safeWebhookUrl("https://8.8.8.8/hook")).toBe(true);
  });
  it("isPrivateAddress: публичные — нет, служебные — да", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2a00:1450:4001::200e")).toBe(false);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
  });
  it("редкие записи IPv6: IPv4-совместимые, NAT64, 6to4, Teredo, полная запись", () => {
    expect(isPrivateAddress("::7f00:1")).toBe(true);
    expect(isPrivateAddress("::127.0.0.1")).toBe(true);
    expect(isPrivateAddress("64:ff9b::7f00:1")).toBe(true);
    expect(isPrivateAddress("64:ff9b::a9fe:a9fe")).toBe(true);
    expect(isPrivateAddress("64:ff9b:1::1")).toBe(true);
    expect(isPrivateAddress("2002:7f00:1::")).toBe(true);
    expect(isPrivateAddress("2002:c0a8:101::1")).toBe(true);
    expect(isPrivateAddress("2001:0:4136:e378::1")).toBe(true);
    expect(isPrivateAddress("2001:db8::1")).toBe(true);
    expect(isPrivateAddress("fec0::1")).toBe(true);
    expect(isPrivateAddress("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isPrivateAddress("0000:0000:0000:0000:0000:ffff:7f00:0001")).toBe(true);
    expect(isPrivateAddress("64:ff9b::808:808")).toBe(false);
    expect(isPrivateAddress("2002:808:808::1")).toBe(false);
    expect(isPrivateAddress("2a00:1450:4001::200e")).toBe(false);
    expect(isPrivateAddress("не адрес")).toBe(true);
    expect(isPrivateAddress("1::2::3")).toBe(true);
    for (const h of ["[::7f00:1]", "[64:ff9b::7f00:1]", "[2002:a00:1::]"])
      expect(safeWebhookUrl(`https://${h}/hook`)).toBe(false);
  });
});

describe("вебхук CRM: соединение идёт на проверенный адрес (DNS rebinding)", () => {
  type Addr = { address: string; family: number };
  const lookupWith = (answers: Addr[][]) => {
    let call = 0;
    const resolve = async () => answers[Math.min(call++, answers.length - 1)]!;
    const lookup = pinnedLookup(resolve);
    return (all: boolean) =>
      new Promise<{ err: Error | null; addr: unknown; family?: number }>((done) =>
        lookup("hook.example", { all }, (err, addr, family) => done({ err, addr, family })),
      );
  };

  it("хоть один внутренний адрес у имени — отказ", async () => {
    const r = await lookupWith([
      [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    ])(false);
    expect(r.err?.message).toMatch(/внутренн/);
  });

  it("отдаёт соединению тот же адрес, что проверен", async () => {
    // Второй ответ DNS (подмена) уже не участвует: соединение резолвит один раз.
    const lookup = lookupWith([
      [{ address: "93.184.216.34", family: 4 }],
      [{ address: "127.0.0.1", family: 4 }],
    ]);
    const one = await lookup(false);
    expect(one).toEqual({ err: null, addr: "93.184.216.34", family: 4 });
    const all = await lookup(true);
    expect(all.err?.message).toMatch(/внутренн/);
  });

  it("all: true — список адресов", async () => {
    const r = await lookupWith([[{ address: "2a00:1450:4001::200e", family: 6 }]])(true);
    expect(r.err).toBeNull();
    expect(r.addr).toEqual([{ address: "2a00:1450:4001::200e", family: 6 }]);
  });

  it("ошибка DNS — отказ", async () => {
    const lookup = pinnedLookup(async () => {
      throw new Error("ENOTFOUND");
    });
    const err = await new Promise<Error | null>((done) =>
      lookup("nope.example", {}, (e) => done(e)),
    );
    expect(err?.message).toBe("ENOTFOUND");
  });

  it("postPinned не соединяется с именем, которое резолвится во внутренний адрес", async () => {
    const r = await postPinned("https://localhost:9/hook", {}, "{}", 2_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/внутренн/);
  });
});
