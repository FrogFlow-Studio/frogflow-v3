import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { setEnvForTests } from "@/config/env";
import { SMTP_TIMEOUT_MS, smtpMailer } from "./mail.server";

const mail = { to: "buyer@example.com", subject: "s", text: "t", html: "<p>t</p>" };

beforeEach(() => {
  sendMail.mockReset();
  createTransport.mockClear();
  setEnvForTests({
    SMTP_HOST: "smtp.example.com",
    SMTP_USER: "u",
    SMTP_PASSWORD: "p",
  } as never);
});
afterEach(() => setEnvForTests(undefined));

describe("отправка по SMTP: один вызов, сроки заданы, обрыв не повторяется", () => {
  it("успех: ровно одна отправка, у транспорта есть тайм-ауты", async () => {
    sendMail.mockResolvedValue({});
    expect(await smtpMailer(mail)).toEqual({ ok: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: SMTP_TIMEOUT_MS,
        greetingTimeout: SMTP_TIMEOUT_MS,
        socketTimeout: SMTP_TIMEOUT_MS,
      }),
    );
  });

  it("обрыв: письмо могло дойти — повтора нет, адрес в ошибке замаскирован", async () => {
    sendMail.mockRejectedValue(new Error("read ECONNRESET after RCPT buyer@example.com"));
    const r = await smtpMailer(mail);
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain("buyer@example.com");
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("SMTP не настроен: в сеть не ходим", async () => {
    setEnvForTests({} as never);
    expect(await smtpMailer(mail)).toEqual({ ok: false, error: "SMTP не настроен" });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
