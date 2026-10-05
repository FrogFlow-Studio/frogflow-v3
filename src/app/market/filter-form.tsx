import { useState, type ReactNode } from "react";

/**
 * Форма фильтров площадки (П4). На широком экране — строка над списком, как раньше. На телефоне
 * фильтры спрятаны за кнопкой и открываются панелью снизу на всю ширину; поля в один столбец, без
 * горизонтальной прокрутки. Форма обычная GET: панель — только вид, ссылки и адрес не меняются.
 */
export function FilterForm({
  action,
  openLabel,
  closeLabel,
  children,
}: {
  action: string;
  openLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn-secondary mt-5 w-full sm:hidden"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="filters-open"
      >
        {openLabel}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-10 bg-black/40 sm:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}
      <form
        method="get"
        action={action}
        data-testid="filters"
        className={
          (open
            ? "fixed inset-x-0 bottom-0 z-20 flex max-h-[85vh] flex-col gap-3 overflow-y-auto rounded-t-xl bg-surface p-4 shadow-lg "
            : "hidden ") +
          "[&_.input]:w-full sm:[&_.input]:w-auto sm:static sm:mt-5 sm:flex sm:max-h-none sm:flex-row sm:flex-wrap sm:items-end sm:gap-3 sm:overflow-visible sm:rounded-none sm:bg-transparent sm:p-0 sm:shadow-none"
        }
      >
        {children}
        <button type="button" className="btn-secondary sm:hidden" onClick={() => setOpen(false)}>
          {closeLabel}
        </button>
      </form>
    </>
  );
}
