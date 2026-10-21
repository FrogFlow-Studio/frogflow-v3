import { describe, expect, it, vi } from "vitest";
import { transcribeVoice } from "./transcribe.server";

describe("transcribeVoice (Whisper API)", () => {
  it("возвращает null, если OPENAI_API_KEY не задан", async () => {
    const text = await transcribeVoice("https://cdn.example/voice.ogg", {
      apiKey: "",
    });
    expect(text).toBeNull();
  });

  it("возвращает null при некорректном URL", async () => {
    const text = await transcribeVoice("ftp://cdn.example/voice.ogg", {
      apiKey: "sk-test",
    });
    expect(text).toBeNull();
  });

  it("успешно скачивает аудио и отправляет в Whisper API", async () => {
    const audioData = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://cdn.example/voice.ogg") {
        return new Response(audioData, {
          status: 200,
          headers: { "content-type": "audio/ogg" },
        });
      }
      if (url === "https://api.openai.com/v1/audio/transcriptions") {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer sk-test",
        });
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init?.body as FormData;
        expect(form.get("model")).toBe("whisper-1");
        expect(form.get("file")).toBeDefined();
        return new Response(
          JSON.stringify({ text: "Привет, есть ли у вас постельное бельё евро?" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await transcribeVoice("https://cdn.example/voice.ogg", {
      apiKey: "sk-test",
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    expect(result).toBe("Привет, есть ли у вас постельное бельё евро?");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("возвращает null при ошибке скачивания аудио", async () => {
    const fetchMock = vi.fn(async () => new Response("Not found", { status: 404 }));

    const result = await transcribeVoice("https://cdn.example/voice.ogg", {
      apiKey: "sk-test",
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    expect(result).toBeNull();
  });

  it("возвращает null при ошибке Whisper API", async () => {
    const audioData = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://cdn.example/voice.ogg") {
        return new Response(audioData, {
          status: 200,
          headers: { "content-type": "audio/ogg" },
        });
      }
      return new Response(JSON.stringify({ error: "rate limit" }), { status: 429 });
    });

    const result = await transcribeVoice("https://cdn.example/voice.ogg", {
      apiKey: "sk-test",
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    expect(result).toBeNull();
  });
});
