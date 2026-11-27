import { previewReadonly } from "@/lib/preview";
import { VOICE_MAX_BYTES, type MediaFile, type Transcriber } from "./media";

/**
 * Расшифровка голосовых через Whisper (тот же ключ платформы, что у v3,
 * `core/speech`). В отличие от v3 принимает байты, а не ссылку: ссылка на файл
 * Telegram несёт токен бота и не должна попадать в логи. Сбой, тайм-аут, пустой
 * текст — null без повтора: покупателя попросят написать текстом.
 */
export const WHISPER_TIMEOUT_MS = 25_000;

const EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

export function whisperTranscriber(apiKey: string, fetchFn: typeof fetch = fetch): Transcriber {
  return async (f: MediaFile) => {
    if (previewReadonly() || !apiKey.trim()) return null;
    if (!f.bytes.length || f.bytes.length > VOICE_MAX_BYTES) return null;
    const type = f.mediaType.split(";")[0]!.trim().toLowerCase() || "audio/ogg";
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(f.bytes)], { type }),
      `voice.${EXT[type] ?? "ogg"}`,
    );
    form.append("model", "whisper-1");
    try {
      const res = await fetchFn("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        body: form,
        signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`[v4 voice] Whisper ответил ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { text?: unknown };
      const text = typeof data.text === "string" ? data.text.trim() : "";
      return text || null;
    } catch (e) {
      console.warn(`[v4 voice] расшифровка не удалась: ${e instanceof Error ? e.name : "ошибка"}`);
      return null;
    }
  };
}
