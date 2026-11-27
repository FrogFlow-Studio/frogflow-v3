import { describe, expect, it } from "vitest";
import {
  IMAGE_MAX_BYTES,
  imageBlock,
  sniffImageType,
  voiceCostMicroUsd,
  voiceTooLong,
} from "./media";
import { whisperTranscriber } from "./speech.server";

const OGG = {
  bytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
  mediaType: "audio/ogg; codecs=opus",
};

describe("фото", () => {
  it("тип — по байтам, а не по заголовку канала", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.4"))).toBeNull();
  });

  it("слишком большое или не картинка — не отдаём модели", () => {
    expect(
      imageBlock({
        bytes: new Uint8Array(IMAGE_MAX_BYTES + 1).fill(0xff),
        mediaType: "image/jpeg",
      }),
    ).toEqual({
      ok: false,
      reason: "size",
    });
    expect(
      imageBlock({ bytes: new TextEncoder().encode("%PDF"), mediaType: "image/jpeg" }),
    ).toEqual({
      ok: false,
      reason: "type",
    });
    const ok = imageBlock({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0]), mediaType: "x" });
    expect(ok.ok && ok.block.source).toEqual({
      type: "base64",
      media_type: "image/jpeg",
      data: "/9j/AA==",
    });
  });
});

describe("голосовые", () => {
  it("цена по секундам, неизвестная длительность — по пределу; длиннее 5 минут — нет", () => {
    expect(voiceCostMicroUsd(4.2)).toBe(500);
    expect(voiceCostMicroUsd(null)).toBe(30_000);
    expect(voiceTooLong(301)).toBe(true);
    expect(voiceTooLong(null)).toBe(false);
  });

  it("Whisper: файл уходит байтами, ссылки и токена в запросе нет; текст обрезан", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ text: "  сколько стоит  " }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await whisperTranscriber("sk-test", fake)(OGG)).toBe("сколько стоит");
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    const form = calls[0]!.init.body as FormData;
    expect((form.get("file") as File).name).toBe("voice.ogg");
    expect(form.get("model")).toBe("whisper-1");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("сбой, 500, пустой текст, нет ключа — null без повтора", async () => {
    let n = 0;
    const err = (async () => {
      n++;
      return new Response("x", { status: 500 });
    }) as unknown as typeof fetch;
    expect(await whisperTranscriber("sk", err)(OGG)).toBeNull();
    expect(n).toBe(1);
    const empty = (async () =>
      new Response(JSON.stringify({ text: " " }), { status: 200 })) as unknown as typeof fetch;
    expect(await whisperTranscriber("sk", empty)(OGG)).toBeNull();
    const boom = (async () => {
      throw new Error("reset");
    }) as unknown as typeof fetch;
    expect(await whisperTranscriber("sk", boom)(OGG)).toBeNull();
    expect(await whisperTranscriber(" ", err)(OGG)).toBeNull();
    expect(n).toBe(1);
  });
});
