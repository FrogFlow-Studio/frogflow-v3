import { describe, expect, it } from "vitest";
import { idempotencyKeyFor, runWithZernioEvent } from "./event-context.server";

describe("idempotencyKeyFor", () => {
  it("повтор того же события даёт тот же ключ", async () => {
    const a = await runWithZernioEvent("evt-1", async () => idempotencyKeyFor({ message: "hi" }));
    const b = await runWithZernioEvent("evt-1", async () => idempotencyKeyFor({ message: "hi" }));
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it("разные события с тем же текстом дают разные ключи", async () => {
    const a = await runWithZernioEvent("evt-1", async () => idempotencyKeyFor({ message: "hi" }));
    const b = await runWithZernioEvent("evt-2", async () => idempotencyKeyFor({ message: "hi" }));
    expect(a).not.toBe(b);
  });

  it("разные сообщения внутри одного события дают разные ключи", async () => {
    const [a, b] = await runWithZernioEvent("evt-1", async () => [
      idempotencyKeyFor({ message: "один" }),
      idempotencyKeyFor({ message: "два" }),
    ]);
    expect(a).not.toBe(b);
  });

  it("вне обработки события ключа нет и контекст не протекает", async () => {
    expect(idempotencyKeyFor({ message: "hi" })).toBeUndefined();
    await runWithZernioEvent("evt-1", async () => {});
    expect(idempotencyKeyFor({ message: "hi" })).toBeUndefined();
    expect(await runWithZernioEvent(null, async () => idempotencyKeyFor({}))).toBeUndefined();
  });

  it("явная область (очередь, черновик «Чата», позиция выдачи) важнее события", async () => {
    const scoped = idempotencyKeyFor({ message: "hi" }, "outbox:1");
    expect(scoped).toBeTruthy();
    expect(idempotencyKeyFor({ message: "hi" }, "outbox:1")).toBe(scoped);
    expect(idempotencyKeyFor({ message: "hi" }, "outbox:2")).not.toBe(scoped);
    expect(
      await runWithZernioEvent("evt-1", async () =>
        idempotencyKeyFor({ message: "hi" }, "outbox:1"),
      ),
    ).toBe(scoped);
  });
});
