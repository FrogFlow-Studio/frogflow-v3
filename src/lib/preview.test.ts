import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { telegramApi, telegramUpload } from "@/channels/telegram/api";
import { smtpMailer } from "@/core/mail/mail.server";
import { sendInboxMessage } from "@/channels/zernio/api.server";
import { previewReadonly, previewWebhookResponse } from "./preview";

const fetchMock = vi.fn(async () => Response.json({ ok: true, result: {} }));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

describe("режим предпросмотра (PREVIEW_READONLY)", () => {
  it("по умолчанию выключен: вебхуки работают, Telegram получает запрос", async () => {
    setEnvForTests({});
    expect(previewReadonly()).toBe(false);
    expect(previewWebhookResponse()).toBeNull();
    const r = await telegramApi("t").call("sendMessage", { chat_id: 1, text: "hi" });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("вебхук и крон отвечают 200 без работы", async () => {
    setEnvForTests({ PREVIEW_READONLY: "1" });
    const res = previewWebhookResponse();
    expect(res?.status).toBe(200);
    expect(await res?.json()).toMatchObject({ ok: true, preview: true });
  });

  it("Telegram: sendMessage и загрузка файла не уходят, отказ без error_code (не «точно не принят»)", async () => {
    setEnvForTests({ PREVIEW_READONLY: "1" });
    const sent = await telegramApi("t").call("sendMessage", { chat_id: 1, text: "hi" });
    expect(sent.ok).toBe(false);
    expect(sent.error_code).toBeUndefined();
    const file = { field: "document", name: "a.pdf", data: new Blob(["x"]) };
    const up = await telegramUpload("t", "https://api.telegram.org", "sendDocument", {}, file);
    expect(up.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Telegram: чтение (getMe) в предпросмотре работает", async () => {
    setEnvForTests({ PREVIEW_READONLY: "1" });
    const r = await telegramApi("t").call("getMe");
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("почта не отправляется", async () => {
    setEnvForTests({
      PREVIEW_READONLY: "1",
      SMTP_HOST: "smtp.test",
      SMTP_USER: "u",
      SMTP_PASSWORD: "p",
    });
    const r = await smtpMailer({ to: "a@b.c", subject: "s", text: "t", html: "<p>t</p>" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("PREVIEW_READONLY");
  });

  it("Zernio: сообщение в Instagram не уходит", async () => {
    setEnvForTests({ PREVIEW_READONLY: "1", ZERNIO_API_KEY: "k" });
    const r = await sendInboxMessage("c1", "acc", "привет");
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
