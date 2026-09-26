/**
 * Ошибка для человека: русский текст — для журналов и панели оператора,
 * ключ — для перевода на язык админки продавца (src/app/i18n/admin/errors*).
 * Ядро не знает, кто покажет ошибку, поэтому только называет её; перевод
 * делает серверный слой панели (src/start.ts) по языку продавца.
 *
 *   throw new UserError('orders.notFound', 'Заказ #{no} не найден', { no: 15 });
 *
 * Русский шаблон повторяет строку словаря с тем же ключом — это проверяет
 * тест src/app/i18n/errors.test.ts.
 */
export type UserErrorVars = Record<string, string | number>;

export class UserError extends Error {
  readonly key: string;
  readonly vars: UserErrorVars | undefined;

  constructor(key: string, template: string, vars?: UserErrorVars) {
    super(fill(template, vars));
    this.name = "UserError";
    this.key = key;
    this.vars = vars;
  }
}

export function fill(template: string, vars?: UserErrorVars): string {
  let s = template;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function isUserError(e: unknown): e is UserError {
  return (
    e instanceof UserError ||
    (e instanceof Error && e.name === "UserError" && typeof (e as UserError).key === "string")
  );
}
