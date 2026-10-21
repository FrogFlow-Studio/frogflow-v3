import { env } from "@/config/env";

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB limit for Whisper API
export const AUDIO_FETCH_TIMEOUT_MS = 15_000;
export const WHISPER_API_TIMEOUT_MS = 25_000;

export type TranscribeOptions = {
  apiKey?: string;
  fetchFn?: typeof fetch;
};

/**
 * Быстрая транскрибация голосовых сообщений (WhatsApp / Direct) через Whisper API.
 * Если ключ не задан или расшифровка не удалась — возвращает null,
 * позволяя вызывающему коду штатно ответить «напишите текстом».
 */
export async function transcribeVoice(
  url: string,
  opts: TranscribeOptions = {},
): Promise<string | null> {
  const apiKey = (opts.apiKey ?? env().OPENAI_API_KEY)?.trim();
  if (!apiKey || !/^https?:\/\//i.test(url)) return null;

  const fetchFn = opts.fetchFn ?? fetch;

  try {
    const audioRes = await fetchFn(url, { signal: AbortSignal.timeout(AUDIO_FETCH_TIMEOUT_MS) });
    if (!audioRes.ok) {
      console.warn(`[transcribeVoice] не удалось скачать аудио (${audioRes.status}): ${url}`);
      return null;
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
      console.warn(
        `[transcribeVoice] некорректный размер аудио: ${arrayBuffer?.byteLength ?? 0} байт`,
      );
      return null;
    }

    const contentType = audioRes.headers.get("content-type")?.toLowerCase() || "audio/ogg";
    let filename = "audio.ogg";
    if (contentType.includes("mp4") || contentType.includes("m4a") || url.includes(".m4a")) {
      filename = "audio.m4a";
    } else if (contentType.includes("mp3") || url.includes(".mp3")) {
      filename = "audio.mp3";
    } else if (contentType.includes("wav") || url.includes(".wav")) {
      filename = "audio.wav";
    }

    const blob = new Blob([arrayBuffer], { type: contentType });
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("model", "whisper-1");

    const whisperRes = await fetchFn("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(WHISPER_API_TIMEOUT_MS),
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text().catch(() => "");
      console.warn(`[transcribeVoice] ошибка Whisper API (${whisperRes.status}): ${errText}`);
      return null;
    }

    const data = (await whisperRes.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    return text || null;
  } catch (err) {
    console.warn(
      "[transcribeVoice] исключение при транскрибации:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
