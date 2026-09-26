import { auditedAdminAction } from "@/core/audit/admin-audit";

type Who = { botId: string; username: string };
export type AuditDeps = {
  identity: () => Promise<Who | null>;
  record: (who: Who, action: string, data: unknown) => Promise<void>;
};

/**
 * Тело прослойки журнала (src/start.ts): кто — до вызова (смена своего
 * пароля меняет сессию), запись — только после успеха; ошибка записи
 * журнала действие не отменяет.
 */
export async function auditAdminCall<R>(
  call: {
    next: () => Promise<R>;
    data: unknown;
    method: string;
    serverFnMeta?: { name?: string; filename?: string };
  },
  deps: AuditDeps,
): Promise<R> {
  const action = auditedAdminAction(call.serverFnMeta, call.method);
  if (!action) return call.next();
  const who = await deps.identity();
  const result = await call.next();
  if (who) {
    try {
      await deps.record(who, action, call.data);
    } catch (e) {
      console.warn("[audit]", e);
    }
  }
  return result;
}
