import { afterEach, describe, expect, it } from "vitest";
import { setEnvForTests, env } from "@/config/env";
import { yandexVerificationMeta } from "./verification";

afterEach(() => setEnvForTests(undefined));

describe("подтверждение сайта в Яндекс Вебмастере", () => {
  it("с кодом — метатег yandex-verification, без — ничего", () => {
    expect(yandexVerificationMeta("abc123DEF4567890")).toEqual([
      { name: "yandex-verification", content: "abc123DEF4567890" },
    ]);
    expect(yandexVerificationMeta(null)).toEqual([]);
    expect(yandexVerificationMeta("")).toEqual([]);
  });

  it("окружение: код обрезается по краям, пустой и посторонний текст отбрасываются", () => {
    setEnvForTests({ YANDEX_VERIFICATION: " abc123DEF4567890 " });
    expect(env().YANDEX_VERIFICATION).toBe("abc123DEF4567890");
    setEnvForTests({ YANDEX_VERIFICATION: "" });
    expect(env().YANDEX_VERIFICATION).toBeUndefined();
    // Вставили весь тег целиком — тега с таким содержимым на главной не будет.
    setEnvForTests({ YANDEX_VERIFICATION: '<meta name="yandex-verification" content="abc" />' });
    expect(env().YANDEX_VERIFICATION).toBeUndefined();
    setEnvForTests({});
    expect(env().YANDEX_VERIFICATION).toBeUndefined();
  });
});
