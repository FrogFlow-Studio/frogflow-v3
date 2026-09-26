import { describe, expect, it } from "vitest";
import {
  availableProviders,
  issueWithFallback,
  type IssueRequest,
  type PayProviderKey,
  type SubscriptionPayProvider,
} from "./provider";
import { transferProvider } from "./transfer";
import { normalizeKaspiPhone } from "./phone";

const req: IssueRequest = {
  invoiceId: "inv-1",
  botId: "bot-1",
  amount: 9900,
  currency: "KZT",
  note: "План Basic на месяц",
  requisites: "Kaspi Gold 4400 …",
  ownerPhone: "77001234567",
};

const fake = (
  key: PayProviderKey,
  opts: { unavailable?: string; throws?: string } = {},
): SubscriptionPayProvider => ({
  key,
  unavailable: async () => opts.unavailable ?? null,
  issue: async () => {
    if (opts.throws) throw new Error(opts.throws);
    return { provider: key, externalId: `${key}-42`, ownerText: key };
  },
});

describe("способы оплаты подписки", () => {
  it("готовы только те, у кого нет причины пропуска", async () => {
    const { ready, skipped } = await availableProviders(
      [fake("kaspi_cashier", { unavailable: "кассир не подключён" }), transferProvider],
      req,
    );
    expect(ready.map((p) => p.key)).toEqual(["transfer"]);
    expect(skipped).toEqual([{ provider: "kaspi_cashier", reason: "кассир не подключён" }]);
  });

  it("перевод без реквизитов недоступен; ни одного способа — ошибка", async () => {
    await expect(
      availableProviders([transferProvider], { ...req, requisites: "  " }),
    ).rejects.toThrow(/Реквизиты/);
  });

  it("выставляет первым готовым; упавший уходит в skipped", async () => {
    const { issued, skipped } = await issueWithFallback(
      [fake("kaspi_cashier", { throws: "Kaspi ответил 500" }), transferProvider],
      req,
    );
    expect(issued.provider).toBe("transfer");
    expect(skipped).toEqual([{ provider: "kaspi_cashier", reason: "Kaspi ответил 500" }]);
  });

  it("все способы упали — ошибка с причинами", async () => {
    await expect(
      issueWithFallback([fake("kaspi_cashier", { throws: "нет сети" })], req),
    ).rejects.toThrow(/kaspi_cashier: нет сети/);
  });

  it("номер Kaspi приводится к 7XXXXXXXXXX", () => {
    expect(normalizeKaspiPhone("+7 (700) 123-45-67")).toBe("77001234567");
    expect(normalizeKaspiPhone("87001234567")).toBe("77001234567");
    expect(normalizeKaspiPhone("7001234567")).toBe("77001234567");
    expect(normalizeKaspiPhone("77001234567")).toBe("77001234567");
    expect(normalizeKaspiPhone("123")).toBeNull();
    expect(normalizeKaspiPhone("77001234567890")).toBeNull();
    expect(normalizeKaspiPhone("abc")).toBeNull();
    expect(normalizeKaspiPhone(null)).toBeNull();
  });
});
