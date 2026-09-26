/**
 * Способ оплаты подписки на платформу. Счёт один (subscription_invoices),
 * а довести его до владельца можно по-разному: ссылка и QR Kaspi Pay на
 * сумму счёта, перевод по реквизитам — текстом в бота; владелец отвечает
 * чеком. Способы перебираются по порядку: первый,
 * кто может выставить именно этот счёт, выставляет; упал — следующий.
 * Перевод стоит последним и нужен всегда: это запасной путь.
 */
export type PayProviderKey = "kaspi_link" | "transfer";

/** Статус счёта у способа оплаты, если способ умеет его узнавать. */
export type PayStatus = "pending" | "paid" | "cancelled" | "expired" | "error";

export type IssueRequest = {
  invoiceId: string;
  botId: string;
  amount: number;
  currency: string;
  note: string | null;
  /** Реквизиты для перевода (снимок в счёте). */
  requisites: string;
  /** Номер Kaspi владельца, 7XXXXXXXXXX; null — неизвестен. */
  ownerPhone: string | null;
};

export type Issued = {
  provider: PayProviderKey;
  /** Номер счёта у способа оплаты, по нему узнаётся статус; у перевода нет. */
  externalId: string | null;
  /** Что написать владельцу в бота. */
  ownerText: string;
  /** Куда перейти, чтобы оплатить (для кнопки и QR в админке); у перевода нет. */
  payUrl?: string | null;
};

export interface SubscriptionPayProvider {
  readonly key: PayProviderKey;
  /** null — может выставить этот счёт; иначе причина, почему нет. */
  unavailable(req: Omit<IssueRequest, "invoiceId">): Promise<string | null>;
  issue(req: IssueRequest): Promise<Issued>;
  status?(externalId: string): Promise<PayStatus>;
}

export type Skipped = { provider: PayProviderKey; reason: string };

/** Способы, готовые выставить счёт; если ни одного — ошибка с причиной первого. */
export async function availableProviders(
  providers: SubscriptionPayProvider[],
  req: Omit<IssueRequest, "invoiceId">,
): Promise<{ ready: SubscriptionPayProvider[]; skipped: Skipped[] }> {
  const ready: SubscriptionPayProvider[] = [];
  const skipped: Skipped[] = [];
  for (const p of providers) {
    const reason = await p.unavailable(req).catch((e: unknown) => errText(e));
    if (reason) skipped.push({ provider: p.key, reason });
    else ready.push(p);
  }
  if (!ready.length)
    throw new Error(skipped[0]?.reason ?? "Нет способа оплаты для выставления счёта.");
  return { ready, skipped };
}

/** Выставить первым сработавшим способом из готовых; упавший уходит в skipped. */
export async function issueWithFallback(
  ready: SubscriptionPayProvider[],
  req: IssueRequest,
): Promise<{ issued: Issued; skipped: Skipped[] }> {
  const skipped: Skipped[] = [];
  for (const p of ready) {
    try {
      return { issued: await p.issue(req), skipped };
    } catch (e) {
      skipped.push({ provider: p.key, reason: errText(e) });
    }
  }
  throw new Error(
    `Счёт не выставлен ни одним способом: ${skipped.map((s) => `${s.provider}: ${s.reason}`).join("; ")}`,
  );
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
