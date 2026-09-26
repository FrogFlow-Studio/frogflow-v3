/**
 * Служебные арендаторы платформы: не клиенты, а стенды. Их платежи и планы
 * — тестовые записи, поэтому в выручку и прочие деловые сводки не попадают.
 */
export const INTERNAL_TENANT_IDS: readonly string[] = [
  "b41a34cb-7944-441b-8f71-503184fc0f1f", // «Демо-тестер»: живые тесты пишут только сюда
];

export function isInternalTenant(id: string): boolean {
  return INTERNAL_TENANT_IDS.includes(id);
}
