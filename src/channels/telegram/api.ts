/**
 * Клиент Telegram Bot API. Токен — параметр, не окружение: один деплой
 * обслуживает много ботов.
 */
export type TgResult<T = unknown> = { ok: boolean; result?: T; description?: string };

export type TelegramApi = {
  call<T = unknown>(method: string, payload?: unknown): Promise<TgResult<T>>;
  fileUrl(filePath: string): string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function telegramApi(token: string, apiBase = "https://api.telegram.org"): TelegramApi {
  const base = apiBase.replace(/\/$/, "");
  const url = (method: string) => `${base}/bot${token}/${method}`;

  async function call<T>(method: string, payload: unknown = {}): Promise<TgResult<T>> {
    const MAX = 3;
    for (let attempt = 1; attempt <= MAX; attempt++) {
      let res: Response;
      try {
        res = await fetch(url(method), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        console.error(`[tg] ${method}: сеть`, e);
        await sleep(1000 * attempt);
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as TgResult<T> & {
        parameters?: { retry_after?: number };
      };
      if (res.status === 429 && attempt < MAX) {
        await sleep((data.parameters?.retry_after ?? attempt * 2) * 1000);
        continue;
      }
      if (res.status >= 500 && attempt < MAX) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
        continue;
      }
      const benign = /message is not modified/i.test(data.description ?? "");
      if ((!res.ok || data.ok === false) && !benign) {
        console.error(`[tg] ${method} failed`, res.status, data.description);
      }
      return data;
    }
    return { ok: false, description: "retries exhausted" };
  }

  return {
    call,
    fileUrl: (filePath) => `${base}/file/bot${token}/${filePath}`,
  };
}
