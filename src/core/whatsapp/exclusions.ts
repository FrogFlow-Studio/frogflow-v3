/**
 * Номера, которым продавец обещал не писать (`whatsapp_bot_excluded_phones`):
 * рассылки их пропускают всегда, бот — когда включено
 * `whatsapp_bot_ignore_excluded_contacts`. Казахстан и Россия пишут один
 * номер как +7… и 8…, поэтому сравниваем оба вида.
 */
export function phoneKeys(value: string | null | undefined): string[] {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return [];
  const keys = new Set([digits]);
  if (digits.length === 11 && digits.startsWith("8")) keys.add(`7${digits.slice(1)}`);
  if (digits.length === 10) keys.add(`7${digits}`);
  return [...keys];
}

export function excludedPhoneSet(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const entry of (raw ?? "").split(/[,;\n]+/)) for (const k of phoneKeys(entry)) out.add(k);
  return out;
}

export function isExcludedSender(
  excluded: Set<string>,
  ...candidates: Array<string | null | undefined>
): boolean {
  if (!excluded.size) return false;
  return candidates.some((c) => phoneKeys(c).some((k) => excluded.has(k)));
}
