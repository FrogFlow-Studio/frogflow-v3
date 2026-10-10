import { MODULES, type ModuleKey } from "@/core/modules/registry";

/**
 * Механизм «в разработке» (status: "planned") проверяется и тогда, когда в
 * прайсе не осталось ни одного непроданного модуля: на время теста модуль
 * считается позицией без кода, после — возвращается как был.
 */
export async function asPlanned<T>(key: ModuleKey, fn: () => T | Promise<T>): Promise<T> {
  const def = MODULES[key] as { status: string };
  const was = def.status;
  def.status = "planned";
  try {
    return await fn();
  } finally {
    def.status = was;
  }
}
