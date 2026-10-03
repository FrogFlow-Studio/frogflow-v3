/** Метатег подтверждения Яндекс Вебмастера; без кода тега нет. */
export function yandexVerificationMeta(code: string | null | undefined) {
  return code ? [{ name: "yandex-verification", content: code }] : [];
}
