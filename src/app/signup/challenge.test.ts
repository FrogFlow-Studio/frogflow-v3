import { describe, expect, it } from "vitest";
import {
  CHALLENGE_MAX_AGE_MS,
  CHALLENGE_MIN_FILL_MS,
  POW_BITS,
  challengeNonce,
  issueChallenge,
  verifyChallenge,
} from "./challenge";
import { leadingZeroBits, solveChallenge } from "./challenge-solve";

const SECRET = "test-secret-test-secret-test-secret-42";
const T0 = Date.parse("2026-09-26T12:00:00Z");
// Настоящие 16 бит на медленном раннере CI решаются десятки секунд — в тестах
// та же проверка с 8 битами; на проде verifyChallenge берёт POW_BITS.
const BITS = 8;
const solve = (c: string) => solveChallenge(c, BITS);
const verify = (c: string | undefined, a: string | undefined, now: number) =>
  verifyChallenge(SECRET, c, a, now, BITS);

describe("проверка регистрации на бота", () => {
  it("человек: задача решена, форма заполнялась дольше нескольких секунд — проходит", async () => {
    const c = issueChallenge(SECRET, T0);
    const answer = await solve(c);
    expect(verify(c, answer, T0 + CHALLENGE_MIN_FILL_MS + 1)).toBeNull();
  });

  it("без решения или с чужим ответом — отказ", async () => {
    const c = issueChallenge(SECRET, T0);
    const later = T0 + 60_000;
    expect(verify(c, undefined, later)).not.toBeNull();
    expect(verify(c, "abc", later)).not.toBeNull();
    const answer = await solve(c);
    const other = issueChallenge(SECRET, T0);
    // ответ от одной задачи к другой не подходит (кроме редкого совпадения)
    const reused = verify(other, answer, later);
    const lucky = (await solve(other)) === answer;
    if (!lucky) expect(reused).not.toBeNull();
  });

  it("задачу нельзя выдумать или подписать чужим ключом", async () => {
    const forged = issueChallenge("другой-ключ-другой-ключ-другой-ключ", T0);
    expect(verify(forged, await solve(forged), T0 + 60_000)).toMatch(/обновите/);
    const c = issueChallenge(SECRET, T0);
    const tampered = c.replace(String(T0), String(T0 - 3600_000));
    expect(verify(tampered, await solve(tampered), T0 + 60_000)).toMatch(/обновите/);
    expect(verify("мусор", "1", T0)).toMatch(/обновите/);
    expect(verify(undefined, "1", T0)).toMatch(/обновите/);
  });

  it("мгновенная отправка и устаревшая страница — отказ", async () => {
    const c = issueChallenge(SECRET, T0);
    const answer = await solve(c);
    expect(verify(c, answer, T0 + 500)).toMatch(/быстро/);
    expect(verify(c, answer, T0 + CHALLENGE_MAX_AGE_MS + 1)).toMatch(/обновите/);
  });

  it("задачи разные, у каждой свой отпечаток для защиты от повтора", () => {
    const a = issueChallenge(SECRET, T0);
    const b = issueChallenge(SECRET, T0);
    expect(a).not.toBe(b);
    expect(challengeNonce(a)).toMatch(/^[0-9a-f]{32}$/);
    expect(challengeNonce(a)).not.toBe(challengeNonce(b));
    expect(challengeNonce("мусор")).toBeNull();
  });

  it("сложность — ощутимая для скрипта, но быстрая для браузера", () => {
    expect(POW_BITS).toBeGreaterThanOrEqual(14);
    expect(POW_BITS).toBeLessThanOrEqual(20);
    expect(leadingZeroBits(new Uint8Array([0, 0, 0b0001_0000]))).toBe(19);
    expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
  });
});
